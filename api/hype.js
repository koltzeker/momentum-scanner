// api/hype.js
// Vercel Serverless Function: /api/hype?action=analyze|financials|options|report
// פורט של HYPE/server.js (Express) לפונקציה סטטלס יחידה - ללא הגנת סיסמה (רון ביקש
// אותה רק לעמוד מוני). ניתוב לפי query כדי לצמצם את מספר הפונקציות (מגבלת Vercel
// Hobby: 12 serverless functions לפריסה). משתמש מחדש בשכבת scanner/fundamentals.js
// הקיימת (Finviz + stockanalysis.com + SEC EDGAR - כבר פורטה מהייפ בעבר לרשימת המעקב)
// כדי לא לשכפל קוד סקרייפינג, ובנוסף ב-scanner/yahooOptions.js לשרשרת האופציות.

const {
  fetchFinvizQuote,
  buildAnalysis,
  fetchStockAnalysisFinancials,
  fetchHistoricalPE,
  fetchSecMetrics,
  fetchLatestFilingInfo,
  sleep,
} = require('../scanner/fundamentals');
const { fetchOptionsSummary } = require('../scanner/yahooOptions');
const db = require('../scanner/db');

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';

  try {
    // רשימת המעקב של הייפ - הועברה מ-localStorage בדפדפן למאגר משותף (Postgres) כדי
    // שרענון יומי בצד שרת (scanner/hypeRefresh.js) יוכל לעדכן אותה בלי תלות בדפדפן פתוח.
    if (action === 'watchlist') {
      if (req.method === 'GET') {
        const rows = await db.getHypeWatchlist();
        res.status(200).json({ watchlist: rows });
        return;
      }
      if (req.method === 'POST') {
        const symbol = String(req.body?.symbol || '').trim().toUpperCase();
        if (!symbol) {
          res.status(400).json({ error: 'טיקר חסר' });
          return;
        }
        await db.addToHypeWatchlist(symbol);
        // רענון מיידי כדי שלא יצטרך לחכות לרענון היומי כדי לראות נתונים על הטיקר החדש.
        try {
          const parsed = await fetchFinvizQuote(symbol);
          const analysis = buildAnalysis(symbol, parsed);
          await db.saveHypeSnapshot(symbol, analysis);
        } catch (err) {
          // אם הרענון המיידי נכשל (למשל Finviz חסום כרגע) - הטיקר עדיין נוסף לרשימה,
          // ופשוט יקבל נתונים ברענון היומי הבא.
        }
        res.status(200).json({ ok: true });
        return;
      }
      if (req.method === 'DELETE') {
        const symbol = String(req.query.symbol || '').trim().toUpperCase();
        if (!symbol) {
          res.status(400).json({ error: 'טיקר חסר' });
          return;
        }
        await db.removeFromHypeWatchlist(symbol);
        res.status(200).json({ ok: true });
        return;
      }
      res.status(405).json({ error: 'method not allowed' });
      return;
    }

    // תמונת המצב האחרונה שנשמרה לרשימת המעקב (מהרענון היומי) - נטענת בטעינת העמוד כדי
    // להציג נתונים שמורים מיד, בלי לחכות לרענון ידני שמריץ ניתוח חי לכל הרשימה.
    if (action === 'snapshot') {
      if (req.method !== 'GET') {
        res.status(405).json({ error: 'method not allowed' });
        return;
      }
      const rows = await db.getHypeSnapshots();
      res.status(200).json({ watchlist: rows });
      return;
    }

    if (action === 'analyze') {
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'method not allowed' });
        return;
      }
      const tickers = Array.isArray(req.body?.tickers)
        ? req.body.tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean)
        : [];
      if (!tickers.length) {
        res.status(400).json({ error: 'לא סופקו טיקרים' });
        return;
      }
      const results = [];
      const errors = [];
      for (const ticker of tickers) {
        try {
          const parsed = await fetchFinvizQuote(ticker);
          results.push(buildAnalysis(ticker, parsed));
        } catch (err) {
          errors.push({ ticker, error: err.message });
        }
        if (ticker !== tickers[tickers.length - 1]) await sleep(400);
      }
      results.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
      res.status(200).json({ results, errors });
      return;
    }

    if (action === 'financials') {
      const ticker = String(req.query.ticker || '').trim().toUpperCase();
      if (!ticker) {
        res.status(400).json({ error: 'טיקר חסר' });
        return;
      }
      try {
        const data = await fetchStockAnalysisFinancials(ticker);
        try {
          data.historicalPE = await fetchHistoricalPE(ticker);
        } catch (err) {
          data.historicalPE = null;
          data.historicalPEError = err.message;
        }
        res.status(200).json(data);
      } catch (err) {
        res.status(500).json({
          error: err.message,
          sourceUrl: `https://stockanalysis.com/stocks/${ticker}/financials/?p=quarterly`,
        });
      }
      return;
    }

    if (action === 'options') {
      const ticker = String(req.query.ticker || '').trim().toUpperCase();
      if (!ticker) {
        res.status(400).json({ error: 'טיקר חסר' });
        return;
      }
      try {
        const data = await fetchOptionsSummary(ticker);
        res.status(200).json(data);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
      return;
    }

    if (action === 'report') {
      const ticker = String(req.query.ticker || '').trim().toUpperCase();
      if (!ticker) {
        res.status(400).json({ error: 'טיקר חסר' });
        return;
      }
      try {
        const secUserAgent = process.env.SEC_USER_AGENT || null;
        const metrics = await fetchSecMetrics(ticker, secUserAgent);
        const filing = await fetchLatestFilingInfo(metrics.cik, secUserAgent);
        res.status(200).json({ ticker, companyName: metrics.companyName, metrics, filing });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
      return;
    }

    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
