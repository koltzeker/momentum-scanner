// run.js
// נקודת הכניסה של הסריקה היומית. מיועד לרוץ מתוך GitHub Actions (ראו
// .github/workflows/daily-scan.yml) אחרי סגירת המסחר בארה"ב.
//
// שלבים:
// 1. שולף את רשימת הטיקרים הפעילה (אוניברסה + רשימת מעקב) מה-DB.
// 2. שולף נרות יומיים מ-Yahoo Finance לכל טיקר (עם השהיה בין בקשות).
// 3. שומר את הנרות ב-DB (מטמון להרצות הבאות/בק-טסט).
// 4. מריץ את זיהוי התרחיש (Wave A/B) לכל טיקר, שומר תוצאה ב-momentum_setups.
// 5. מרענן תמונת מצב פונדמנטלית לרשימת המעקב בלבד (לא לכל האוניברסה - כדי לא
//    להיחסם ע"י Finviz/SEC ולא להאריך את זמן הריצה).

'use strict';

const db = require('./db');
const { fetchDailyBars } = require('./dataFetch');
const { detectDailySetup } = require('./waveDetector');
const { fetchFundamentalsSnapshot, sleep } = require('./fundamentals');

const YAHOO_DELAY_MS = Number(process.env.YAHOO_DELAY_MS || 300);
const FUNDAMENTALS_DELAY_MS = Number(process.env.FUNDAMENTALS_DELAY_MS || 600);
const SEC_USER_AGENT = process.env.SEC_USER_AGENT || null;

async function scanSymbol(symbol, scanDate) {
  const fetched = await fetchDailyBars(symbol, '1y');
  if (!fetched || !fetched.bars || !fetched.bars.length) {
    return { symbol, ok: false, reason: 'fetch_failed' };
  }
  await db.saveDailyBars(symbol, fetched.bars);
  const setup = detectDailySetup(fetched.bars, {});
  await db.saveMomentumSetup(symbol, scanDate, setup);
  return { symbol, ok: true, valid: setup.valid };
}

async function runDailyScan() {
  const scanDate = new Date().toISOString().slice(0, 10);
  const runId = await db.logScanRun('daily_scan');

  try {
    const [universe, watchlist] = await Promise.all([db.getActiveSymbols(), db.getWatchlist()]);
    const watchlistSymbols = watchlist.map((w) => w.symbol);
    const allSymbols = Array.from(new Set([...universe, ...watchlistSymbols])).sort();

    console.log(`סורק ${allSymbols.length} טיקרים (אוניברסה: ${universe.length}, רשימת מעקב: ${watchlistSymbols.length})...`);

    let validCount = 0;
    let failCount = 0;
    for (let i = 0; i < allSymbols.length; i++) {
      const symbol = allSymbols[i];
      try {
        const r = await scanSymbol(symbol, scanDate);
        if (!r.ok) failCount++;
        else if (r.valid) {
          validCount++;
          console.log(`  ✅ ${symbol}: תרחיש תקף`);
        }
      } catch (e) {
        failCount++;
        console.error(`  ❌ ${symbol}: ${e.message}`);
      }
      if (i < allSymbols.length - 1) await sleep(YAHOO_DELAY_MS);
      if ((i + 1) % 50 === 0) console.log(`  התקדמות: ${i + 1}/${allSymbols.length}`);
    }

    console.log(`\nסריקה יומית הסתיימה: ${validCount} תרחישים תקפים, ${failCount} כשלונות שליפה.`);

    // רענון פונדמנטלס לרשימת המעקב בלבד
    for (const w of watchlist) {
      try {
        const snap = await fetchFundamentalsSnapshot(w.symbol, { secUserAgent: SEC_USER_AGENT });
        await db.saveFundamentalsSnapshot(w.symbol, snap);
        console.log(`  📊 ${w.symbol}: פונדמנטלס עודכנו`);
      } catch (e) {
        console.error(`  ⚠️ ${w.symbol}: כשל ברענון פונדמנטלס - ${e.message}`);
      }
      await sleep(FUNDAMENTALS_DELAY_MS);
    }

    await db.finishScanRun(runId, {
      symbolsCount: allSymbols.length,
      validCount,
      status: 'ok',
    });
  } catch (e) {
    await db.finishScanRun(runId, { symbolsCount: null, validCount: null, status: 'error', errorMessage: e.message });
    throw e;
  }
}

if (require.main === module) {
  runDailyScan()
    .then(() => {
      console.log('הסתיים בהצלחה.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('הסריקה נכשלה:', e);
      process.exit(1);
    });
}

module.exports = { runDailyScan, scanSymbol };
