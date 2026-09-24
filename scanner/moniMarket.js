// moniMarket.js
// שכבת נתוני השוק עבור עמוד "מוני" (web/moni.html) - פורט כמעט ישיר של הפונקציות
// המקבילות מ-MONEY/server.js (הגרסה המקומית הישנה של מוני), מותאם לריצה כ-Vercel
// Serverless Function במקום שרת Node מתמשך. משתמש ב-yahooGet המשותף מ-dataFetch.js
// (אותו helper בדיוק, גם ב-Moni המקורי וגם בסריקה הרחבה).

'use strict';

const { yahooGet, sleep } = require('./dataFetch');

// נרות 5 דקות + Pre-Market (יום המסחר הנוכחי)
async function fetchIntraday(sym) {
  const j = await yahooGet(
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=1d&includePrePost=true`
  );
  if (!j?.chart?.result?.[0]) return null;
  const r = j.chart.result[0],
    meta = r.meta,
    ts = r.timestamp || [],
    q = r.indicators?.quote?.[0];
  let sumPV = 0,
    sumV = 0;
  const reg = [],
    pre = [];
  for (let i = 0; i < ts.length; i++) {
    if (!q.close[i]) continue;
    const dt = new Date(ts[i] * 1000),
      h = dt.getUTCHours(),
      m = dt.getUTCMinutes();
    const isR = (h > 13 || (h === 13 && m >= 30)) && h < 20;
    const isP = h >= 10 && (h < 13 || (h === 13 && m < 30));
    const e = {
      t: dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      o: +((q.open[i] || 0).toFixed(2)),
      h: +((q.high[i] || 0).toFixed(2)),
      l: +((q.low[i] || 0).toFixed(2)),
      c: +((q.close[i] || 0).toFixed(2)),
      v: Math.round((q.volume[i] || 0) / 1000),
    };
    if (isR) {
      sumPV += ((e.h + e.l + e.c) / 3) * (q.volume[i] || 0);
      sumV += q.volume[i] || 0;
      reg.push(e);
    } else if (isP) pre.push(e);
  }
  return {
    sym,
    price: meta.regularMarketPrice,
    prev: meta.chartPreviousClose,
    chg: +(((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100).toFixed(2),
    vol: Math.round(meta.regularMarketVolume / 1000),
    vwap: sumV > 0 ? +(sumPV / sumV).toFixed(2) : null,
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    h52: meta.fiftyTwoWeekHigh,
    l52: meta.fiftyTwoWeekLow,
    preH: pre.length ? +Math.max(...pre.map((p) => p.h)).toFixed(2) : null,
    preL: pre.length ? +Math.min(...pre.map((p) => p.l)).toFixed(2) : null,
    reg,
    regLen: reg.length,
  };
}

// נרות 15 דקות - 5 ימים
async function fetch15m(sym) {
  const j = await yahooGet(
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=15m&range=5d&includePrePost=false`
  );
  if (!j?.chart?.result?.[0]) return [];
  const r = j.chart.result[0],
    ts = r.timestamp || [],
    q = r.indicators?.quote?.[0];
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    if (!q.close[i]) continue;
    const dt = new Date(ts[i] * 1000),
      h = dt.getUTCHours(),
      m = dt.getUTCMinutes();
    if ((h > 13 || (h === 13 && m >= 30)) && h < 20)
      candles.push({
        t: dt.getDate() + '.' + (dt.getMonth() + 1) + ' ' + dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        h: +((q.high[i] || 0).toFixed(2)),
        l: +((q.low[i] || 0).toFixed(2)),
        c: +((q.close[i] || 0).toFixed(2)),
        v: Math.round((q.volume[i] || 0) / 1000),
      });
  }
  return candles.slice(-40);
}

// נרות יומיים 3 חודשים (daily + MA50 + MA200 + ATR + נפח ממוצע + VWAP חודשי)
async function fetchDailyForMoni(sym) {
  const j = await yahooGet(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=3mo`);
  if (!j?.chart?.result?.[0]) return {};
  const r = j.chart.result[0],
    ts = r.timestamp || [],
    q = r.indicators?.quote?.[0];
  const days = [];
  for (let i = 0; i < ts.length; i++) {
    if (!q.close[i]) continue;
    const dt = new Date(ts[i] * 1000);
    days.push({
      dt: dt.getDate() + '.' + (dt.getMonth() + 1),
      h: +q.high[i].toFixed(2),
      l: +q.low[i].toFixed(2),
      c: +q.close[i].toFixed(2),
      v: Math.round((q.volume[i] || 0) / 1000),
    });
  }
  const ma50 = days.length >= 50 ? +(days.slice(-50).reduce((s, d) => s + d.c, 0) / 50).toFixed(2) : null;
  const ma200 = days.length >= 200 ? +(days.slice(-200).reduce((s, d) => s + d.c, 0) / 200).toFixed(2) : null;
  let atrSum = 0,
    atrCount = 0;
  for (let i = Math.max(1, days.length - 14); i < days.length; i++) {
    const tr = Math.max(days[i].h - days[i].l, Math.abs(days[i].h - days[i - 1].c), Math.abs(days[i].l - days[i - 1].c));
    atrSum += tr;
    atrCount++;
  }
  const atr = atrCount > 0 ? +(atrSum / atrCount).toFixed(2) : null;
  const avgVol10 = days.length >= 10 ? Math.round(days.slice(-10).reduce((s, d) => s + d.v, 0) / 10) : null;
  const last30 = days.slice(-30);
  let mPV = 0,
    mV = 0;
  last30.forEach((d) => {
    mPV += ((d.h + d.l + d.c) / 3) * d.v;
    mV += d.v;
  });
  const vwapMonthly = mV > 0 ? +(mPV / mV).toFixed(2) : null;
  return { days: days.slice(-14), ma50, ma200, atr, avgVol10, vwapMonthly };
}

// VWAP שבועי
async function fetchWeeklyVwap(sym) {
  const j = await yahooGet(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=5d&includePrePost=false`);
  if (!j?.chart?.result?.[0]) return null;
  const r = j.chart.result[0],
    ts = r.timestamp || [],
    q = r.indicators?.quote?.[0];
  let sumPV = 0,
    sumV = 0;
  for (let i = 0; i < ts.length; i++) {
    if (!q.close[i]) continue;
    const dt = new Date(ts[i] * 1000),
      h = dt.getUTCHours(),
      m = dt.getUTCMinutes();
    if ((h > 13 || (h === 13 && m >= 30)) && h < 20) {
      sumPV += ((q.high[i] + q.low[i] + q.close[i]) / 3) * (q.volume[i] || 0);
      sumV += q.volume[i] || 0;
    }
  }
  return sumV > 0 ? +(sumPV / sumV).toFixed(2) : null;
}

// חדשות ממניה דרך Yahoo Finance
async function fetchNews(sym) {
  const j = await yahooGet(`https://query1.finance.yahoo.com/v1/finance/search?q=${sym}&newsCount=5&quotesCount=0`);
  if (!j?.news) return [];
  return j.news.slice(0, 5).map((n) => ({
    title: n.title,
    time:
      new Date(n.providerPublishTime * 1000).toLocaleDateString('he-IL') +
      '  ' +
      new Date(n.providerPublishTime * 1000).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
  }));
}

// מצב שוק כללי (SPY + QQQ)
async function fetchMarketContext() {
  const spy = await fetchIntraday('SPY');
  await sleep(1500);
  const qqq = await fetchIntraday('QQQ');
  return {
    spy: spy ? { price: spy.price, chg: spy.chg, vwap: spy.vwap, above: spy.vwap && spy.price > spy.vwap } : null,
    qqq: qqq ? { price: qqq.price, chg: qqq.chg, vwap: qqq.vwap, above: qqq.vwap && qqq.price > qqq.vwap } : null,
  };
}

// שליפה מלאה לכל מניה (בשימוש ע"י api/moni-market.js)
async function fetchFull(sym) {
  const intra = await fetchIntraday(sym);
  if (!intra) return null;
  await sleep(300);
  const daily = await fetchDailyForMoni(sym);
  await sleep(300);
  const candles15m = await fetch15m(sym);
  await sleep(300);
  const vwapW = await fetchWeeklyVwap(sym);
  await sleep(300);
  const news = await fetchNews(sym);
  intra.daily = daily.days || [];
  intra.ma50 = daily.ma50;
  intra.ma200 = daily.ma200;
  intra.atr = daily.atr;
  intra.avgVol10 = daily.avgVol10;
  intra.vwapMonthly = daily.vwapMonthly;
  intra.vwapWeekly = vwapW;
  intra.candles15m = candles15m;
  intra.news = news;
  return intra;
}

module.exports = { fetchIntraday, fetch15m, fetchDailyForMoni, fetchWeeklyVwap, fetchNews, fetchMarketContext, fetchFull };
