// api/moni-market.js
// Vercel Serverless Function: POST /api/moni-market  body: { syms: string[] }
// שולף נתוני שוק מלאים (Yahoo Finance) לכל טיקר ברשימה - פורט של POST /market
// מ-MONEY/server.js (הגרסה המקומית הישנה). מוגן באותה הגנת סיסמה כמו שאר עמוד מוני.
//
// שים לב: לכל טיקר יש כמה קריאות רשת עוקבות עם השהיות קטנות (ראו scanner/moniMarket.js),
// ובנוסף השהיה של 1.5 שניות בין טיקר לטיקר כדי לא להיחסם ע"י Yahoo - בדיוק כמו במקור.
// עם רשימת מעקב/פוזיציות גדולה מדי זה עלול להתקרב ל-maxDuration של 60 שניות שמוגדר
// ב-vercel.json לכל הפונקציות - מומלץ לשמור על עד כ-8-10 טיקרים בעדכון ידני אחד.

const { requireAuth } = require('../scanner/moniAuth');
const { fetchFull, fetchMarketContext } = require('../scanner/moniMarket');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  const { syms } = req.body || {};
  if (!Array.isArray(syms) || !syms.length) {
    res.status(400).json({ error: 'חסרה רשימת טיקרים (syms)' });
    return;
  }

  const out = {};
  for (const sym of syms) {
    try {
      const r = await fetchFull(sym);
      if (r) out[sym] = r;
    } catch (e) {
      // מניה בודדת שנכשלה לא אמורה להפיל את כל הבקשה
    }
    if (sym !== syms[syms.length - 1]) await sleep(1500);
  }

  try {
    out._market = await fetchMarketContext();
  } catch (e) {
    out._market = null;
  }

  res.status(200).json(out);
};
