// api/refresh-symbol.js
// Vercel Serverless Function: POST /api/refresh-symbol { symbol: "NUVB" }
// רענון ידני (על-פי דרישה) למניה בודדת - מריץ שליפת נתונים + זיהוי Wave A/B + (אם המניה
// ברשימת המעקב) גם רענון פונדמנטלס, ומחזיר את התוצאה מיידית. זה המקביל ל"רענן עכשיו"
// הידני שהיה ב-Moni, בלי לחכות להרצה היומית המתוזמנת.
//
// שים לב: רענון של כל האוניברסה (מאות טיקרים) לא מתאים לפונקציית Vercel (מגבלת זמן ריצה) -
// לכך משמש api/trigger-full-scan.js שמפעיל את ה-GitHub Action במקום.

const { fetchDailyBars } = require('../scanner/dataFetch');
const { detectDailySetup } = require('../scanner/waveDetector');
const { fetchFundamentalsSnapshot } = require('../scanner/fundamentals');
const db = require('../scanner/db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const symbol = String(req.body?.symbol || '').trim().toUpperCase();
  if (!symbol) {
    res.status(400).json({ error: 'חסר טיקר' });
    return;
  }

  try {
    const fetched = await fetchDailyBars(symbol, '1y');
    if (!fetched || !fetched.bars?.length) {
      res.status(502).json({ error: `לא הצלחתי לשלוף נתונים עבור ${symbol} מ-Yahoo Finance` });
      return;
    }
    await db.saveDailyBars(symbol, fetched.bars);
    const setup = detectDailySetup(fetched.bars, {});
    const scanDate = new Date().toISOString().slice(0, 10);
    await db.saveMomentumSetup(symbol, scanDate, setup);

    let fundamentals = null;
    const isWatched = (await db.getWatchlist()).some((w) => w.symbol === symbol);
    if (isWatched) {
      try {
        fundamentals = await fetchFundamentalsSnapshot(symbol, { secUserAgent: process.env.SEC_USER_AGENT });
        await db.saveFundamentalsSnapshot(symbol, fundamentals);
      } catch (e) {
        fundamentals = { error: e.message };
      }
    }

    res.status(200).json({ symbol, setup, fundamentals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
