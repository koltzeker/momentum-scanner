// yahooOptions.js
// שרשרת אופציות (Yahoo Finance) עבור עמוד "הייפ" - פורט של getYahooSession/
// fetchOptionsSummary מ-HYPE/server.js. Yahoo דורש handshake של cookie+crumb לפני
// שאפשר לקרוא ל-API הזה; ה-handshake נשמר בזיכרון (in-memory) ומחודש אוטומטית אם
// נכשל. בסביבת Serverless (Vercel) הזיכרון הזה חי רק כל עוד ה-instance חם, כך שלפעמים
// יתבצע handshake מחדש - זה תקין ולא דורש שינוי.

'use strict';

const FINVIZ_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

let yahooSession = null;

async function getYahooSession(forceRefresh = false) {
  if (yahooSession && !forceRefresh) return yahooSession;

  const cookieResp = await fetch('https://fc.yahoo.com', {
    headers: FINVIZ_HEADERS,
    redirect: 'manual',
  });
  const rawCookies =
    typeof cookieResp.headers.getSetCookie === 'function'
      ? cookieResp.headers.getSetCookie()
      : [cookieResp.headers.get('set-cookie')].filter(Boolean);
  const cookie = rawCookies.map((c) => c.split(';')[0]).join('; ');

  const crumbResp = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...FINVIZ_HEADERS, Cookie: cookie },
  });
  if (!crumbResp.ok) {
    throw new Error(`Yahoo crumb HTTP ${crumbResp.status} - ייתכן שהחסימה שלהם השתנתה`);
  }
  const crumb = (await crumbResp.text()).trim();
  if (!crumb || crumb.includes('<html')) {
    throw new Error('Yahoo לא החזיר crumb תקין - ההגנה מפני scraping שלהם כנראה השתנתה');
  }

  yahooSession = { cookie, crumb };
  return yahooSession;
}

async function fetchOptionsSummary(ticker, retry = true) {
  const session = await getYahooSession();
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(
    ticker
  )}?crumb=${encodeURIComponent(session.crumb)}`;
  const resp = await fetch(url, { headers: { ...FINVIZ_HEADERS, Cookie: session.cookie } });

  if (!resp.ok) {
    if (retry && (resp.status === 401 || resp.status === 403)) {
      yahooSession = null;
      await getYahooSession(true);
      return fetchOptionsSummary(ticker, false);
    }
    const bodyText = await resp.text().catch(() => '');
    throw new Error(`Yahoo HTTP ${resp.status}${bodyText ? ' - ' + bodyText.slice(0, 200) : ''}`);
  }

  const data = await resp.json();
  const yahooError = data && data.optionChain && data.optionChain.error;
  if (yahooError) {
    throw new Error(`Yahoo error: ${yahooError.description || JSON.stringify(yahooError)}`);
  }
  const result = data && data.optionChain && data.optionChain.result && data.optionChain.result[0];
  if (!result || !result.options || !result.options[0]) {
    throw new Error('אין נתוני אופציות זמינים למניה זו');
  }

  const { calls = [], puts = [] } = result.options[0];
  const sum = (arr, key) => arr.reduce((s, o) => s + (Number(o[key]) || 0), 0);

  const callOI = sum(calls, 'openInterest');
  const putOI = sum(puts, 'openInterest');
  const callVol = sum(calls, 'volume');
  const putVol = sum(puts, 'volume');

  const topByOI = (arr) => arr.slice().sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0))[0] || null;

  const topCall = topByOI(calls);
  const topPut = topByOI(puts);

  return {
    ticker,
    expirationDate: result.options[0].expirationDate
      ? new Date(result.options[0].expirationDate * 1000).toISOString().slice(0, 10)
      : null,
    callOpenInterest: callOI,
    putOpenInterest: putOI,
    putCallOIRatio: callOI ? putOI / callOI : null,
    callVolume: callVol,
    putVolume: putVol,
    putCallVolumeRatio: callVol ? putVol / callVol : null,
    topCallStrike: topCall ? { strike: topCall.strike, openInterest: topCall.openInterest } : null,
    topPutStrike: topPut ? { strike: topPut.strike, openInterest: topPut.openInterest } : null,
    note: 'מבוסס על תאריך הפקיעה הקרוב ביותר בלבד, לא כל השרשרת',
  };
}

module.exports = { fetchOptionsSummary };
