// hypeRefresh.js
// רענון יומי לרשימת המעקב של עמוד "הייפ" (/hype.html) - נקודת כניסה נפרדת מ-run.js
// (הסריקה היומית של מומנטום), כי מדובר בשתי רשימות ובלוגיקה שונות לגמרי (ניתוח
// פונדמנטלי בלבד, לא זיהוי תרחיש Wave A/B). מיועד לרוץ מתוך GitHub Actions
// (ראו .github/workflows/hype-refresh.yml) פעם ביום, כדי שהעמוד יציג נתונים שמורים
// מוכנים מיד בטעינה, במקום להסתמך אך ורק על רענון ידני בדפדפן.

'use strict';

const db = require('./db');
const { fetchFinvizQuote, buildAnalysis, sleep } = require('./fundamentals');

const REFRESH_DELAY_MS = Number(process.env.HYPE_REFRESH_DELAY_MS || 500);

async function refreshHypeWatchlist() {
  const watchlist = await db.getHypeWatchlist();
  console.log(`מרענן ${watchlist.length} טיקרים ברשימת המעקב של הייפ...`);

  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < watchlist.length; i++) {
    const { symbol } = watchlist[i];
    try {
      const parsed = await fetchFinvizQuote(symbol);
      const analysis = buildAnalysis(symbol, parsed);
      await db.saveHypeSnapshot(symbol, analysis);
      okCount++;
      console.log(`  ✅ ${symbol}: עודכן (ניקוד ${Math.round(analysis.score)})`);
    } catch (e) {
      failCount++;
      console.error(`  ❌ ${symbol}: ${e.message}`);
    }
    if (i < watchlist.length - 1) await sleep(REFRESH_DELAY_MS);
  }

  console.log(`\nרענון הייפ הסתיים: ${okCount} עודכנו, ${failCount} כשלונות.`);
}

if (require.main === module) {
  refreshHypeWatchlist()
    .then(() => {
      console.log('הסתיים בהצלחה.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('רענון הייפ נכשל:', e);
      process.exit(1);
    });
}

module.exports = { refreshHypeWatchlist };
