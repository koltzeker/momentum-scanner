// dataFetch.js
// שליפת נרות יומיים מ-Yahoo Finance - פורט של yahooGet/fetchDaily מ-Moni (MONEY/server.js),
// מותאם לצרכי הסריקה הרחבה (יותר היסטוריה, וקצב בקשות מבוקר לאוניברסה גדולה).

'use strict';

const https = require('https');
const zlib = require('zlib');

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function yahooGet(url) {
  return new Promise((resolve) => {
    const opts = {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://finance.yahoo.com/',
        Connection: 'keep-alive',
      },
    };
    const req = https.get(url, opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          const encoding = res.headers['content-encoding'];
          let outBuf = buf;
          if (encoding === 'gzip') outBuf = zlib.gunzipSync(buf);
          else if (encoding === 'br') outBuf = zlib.brotliDecompressSync(buf);
          else if (encoding === 'deflate') outBuf = zlib.inflateSync(buf);
          resolve(JSON.parse(outBuf.toString('utf8')));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(12000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * שולף נרות יומיים למניה בודדת, בפורמט שמתאים ישירות ל-waveDetector.detectDailySetup:
 * מערך מהישן לחדש של {date, high, low, close, volume}.
 * range ברירת מחדל 1y - מספיק בשוליים גדולים למינימום הנדרש בלוגיקת הגלים, ועוד מרווח
 * לשימושים עתידיים (בק-טסט וכו').
 */
async function fetchDailyBars(sym, range = '1y') {
  const j = await yahooGet(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}`
  );
  if (!j?.chart?.result?.[0]) return null;
  const r = j.chart.result[0];
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0];
  if (!q) return null;
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue;
    const dt = new Date(ts[i] * 1000);
    bars.push({
      date: dt.toISOString().slice(0, 10),
      high: +q.high[i].toFixed(4),
      low: +q.low[i].toFixed(4),
      close: +q.close[i].toFixed(4),
      volume: Math.round(q.volume[i] || 0),
    });
  }
  return {
    sym,
    bars,
    meta: {
      price: r.meta.regularMarketPrice,
      prevClose: r.meta.chartPreviousClose,
      currency: r.meta.currency,
      exchangeName: r.meta.exchangeName,
    },
  };
}

/**
 * שולף נרות יומיים לרשימת טיקרים ברצף, עם השהיה בין בקשות כדי לא להיחסם ע"י Yahoo
 * (כמו ב-Moni). מחזיר Map<sym, result|null>. מיועד לאוניברסת סריקה גדולה.
 */
async function fetchDailyBarsBatch(symbols, { delayMs = 300, range = '1y', onProgress } = {}) {
  const out = new Map();
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    try {
      const r = await fetchDailyBars(sym, range);
      out.set(sym, r);
    } catch (e) {
      out.set(sym, null);
    }
    if (onProgress) onProgress(i + 1, symbols.length, sym);
    if (i < symbols.length - 1) await sleep(delayMs);
  }
  return out;
}

module.exports = { fetchDailyBars, fetchDailyBarsBatch, yahooGet, sleep };
