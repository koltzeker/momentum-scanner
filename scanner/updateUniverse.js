// updateUniverse.js
// מעדכן את אוניברסת הסריקה הרחבה (S&P 500 + Nasdaq-100) בטבלת tickers ב-DB.
// רץ בנפרד מהסריקה היומית (ראו .github/workflows/update-universe.yml) - למשל פעם בשבוע -
// כי רשימת המדדים כמעט לא משתנה מיום ליום, ואין טעם לגרד אותה כל לילה.
//
// המקור: טבלאות ה-Wikipedia הציבוריות (עדכניות באופן סביר, בלי צורך במפתח API).
// אם ויקיפדיה משנה מבנה HTML בעתיד, יהיה צריך לעדכן את הסלקטורים כאן - בדיוק כמו
// שקורה מדי פעם ל-parseFinvizHtml בהייפ.

'use strict';

const cheerio = require('cheerio');
const { upsertTickers } = require('./db');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
};

// טיקרים כמו BRK.B מוצגים בויקיפדיה עם נקודה, אבל Yahoo Finance דורש מקף (BRK-B).
function normalizeForYahoo(sym) {
  return sym.trim().toUpperCase().replace(/\./g, '-');
}

async function fetchSp500() {
  const resp = await fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', { headers: HEADERS });
  if (!resp.ok) throw new Error(`Wikipedia S&P500 HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);
  const table = $('table#constituents');
  const out = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((__, td) => $(td).text().trim())
      .get();
    if (cells.length < 2) return;
    const [symbol, name] = cells;
    if (symbol) out.push({ symbol: normalizeForYahoo(symbol), name, index: 'SP500' });
  });
  return out;
}

async function fetchNasdaq100() {
  const resp = await fetch('https://en.wikipedia.org/wiki/Nasdaq-100', { headers: HEADERS });
  if (!resp.ok) throw new Error(`Wikipedia Nasdaq-100 HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);
  const out = [];
  // הטבלה עם רשימת החברות מזוהה לפי כותרת "Ticker"/"Symbol" - נחפש את הטבלה הנכונה
  $('table.wikitable').each((_, table) => {
    const headerCells = $(table)
      .find('tr')
      .first()
      .find('th')
      .map((__, th) => $(th).text().trim().toLowerCase())
      .get();
    const symbolIdx = headerCells.findIndex((h) => h.includes('ticker') || h.includes('symbol'));
    const nameIdx = headerCells.findIndex((h) => h.includes('company'));
    if (symbolIdx === -1) return;
    $(table)
      .find('tbody tr')
      .each((_, tr) => {
        const cells = $(tr)
          .find('td')
          .map((__, td) => $(td).text().trim())
          .get();
        if (!cells.length || !cells[symbolIdx]) return;
        out.push({
          symbol: normalizeForYahoo(cells[symbolIdx]),
          name: nameIdx !== -1 ? cells[nameIdx] : cells[symbolIdx],
          index: 'NDX100',
        });
      });
  });
  return out;
}

async function updateUniverse() {
  const [sp500, ndx100] = await Promise.all([fetchSp500(), fetchNasdaq100()]);
  const merged = new Map();
  for (const row of [...sp500, ...ndx100]) {
    if (!merged.has(row.symbol)) {
      merged.set(row.symbol, { symbol: row.symbol, name: row.name, indices: [row.index] });
    } else if (!merged.get(row.symbol).indices.includes(row.index)) {
      merged.get(row.symbol).indices.push(row.index);
    }
  }
  const tickers = Array.from(merged.values());
  await upsertTickers(tickers);
  console.log(`עודכנו ${tickers.length} טיקרים באוניברסת הסריקה (S&P500: ${sp500.length}, Nasdaq-100: ${ndx100.length}).`);
  return tickers;
}

if (require.main === module) {
  updateUniverse()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('שגיאה בעדכון האוניברסה:', e);
      process.exit(1);
    });
}

module.exports = { updateUniverse, fetchSp500, fetchNasdaq100, normalizeForYahoo };
