// fundamentals.js
// שכבת הנתונים הפונדמנטליים - פורט כמעט ישיר מ-הייפ (server.js): Finviz + SEC EDGAR +
// stockanalysis.com. משמש לרענון "רשימת המעקב" (לא לסריקה הרחבה, כדי לא להעמיס/להיחסם).
//
// דורש Node >= 18 (fetch גלובלי) וחבילת cheerio.

'use strict';

const cheerio = require('cheerio');

const FINVIZ_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function secHeaders(secUserAgent) {
  return {
    'User-Agent': secUserAgent || 'Momentum Scanner Personal Tool (no contact configured)',
    'Accept-Encoding': 'gzip, deflate',
  };
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// "15.20%" -> 15.2 | "-" -> null | "1.25B" -> 1250000000
function parseNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const val = String(raw).trim();
  if (val === '-' || val === '') return null;
  const suffixMatch = val.match(/^(-?[\d.]+)([BMK%])?$/i);
  if (!suffixMatch) {
    const cleaned = val.replace(/[^0-9.\-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  let num = parseFloat(suffixMatch[1]);
  const suffix = suffixMatch[2];
  if (suffix === 'B') num *= 1e9;
  else if (suffix === 'M') num *= 1e6;
  else if (suffix === 'K') num *= 1e3;
  return isNaN(num) ? null : num;
}

function parseFinvizHtml(html, ticker) {
  const $ = cheerio.load(html);
  const map = {};
  $('table.snapshot-table2 tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((__, td) => $(td).text().trim())
      .get();
    for (let i = 0; i < cells.length - 1; i += 2) {
      map[cells[i]] = cells[i + 1];
    }
  });
  const companyName =
    $('.quote-header_ticker-wrapper_company, .fullview-title').first().text().trim() || ticker;
  const news = [];
  $('#news-table tr').each((i, tr) => {
    if (i >= 8) return;
    const dateCell = $(tr).find('td').first().text().trim();
    const link = $(tr).find('a.tab-link-news, a').first();
    const title = link.text().trim();
    const href = link.attr('href');
    if (title) news.push({ date: dateCell, title, url: href });
  });
  if (!map['Price'] && !companyName) {
    throw new Error(`לא נמצאו נתונים עבור ${ticker} - ייתכן שהטיקר שגוי`);
  }
  return { map, companyName, news };
}

async function fetchFinvizQuote(ticker) {
  const url = `https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}&p=d`;
  const resp = await fetch(url, { headers: FINVIZ_HEADERS });
  if (!resp.ok) throw new Error(`Finviz HTTP ${resp.status} עבור ${ticker}`);
  const html = await resp.text();
  return parseFinvizHtml(html, ticker);
}

// אותה שיטת "מחיר הוגן" ו-Score כמו בהייפ - ראו README ההוא לפירוט הנוסחה.
function buildAnalysis(ticker, parsed) {
  const { map, companyName, news } = parsed;
  const price = parseNumber(map['Price']);
  const peTTM = parseNumber(map['P/E']);
  const forwardPE = parseNumber(map['Forward P/E']);
  const epsTTM = parseNumber(map['EPS (ttm)']);
  const epsNextY = parseNumber(map['EPS next Y']);
  const eps5Y = parseNumber(map['EPS next 5Y']);
  const targetPrice = parseNumber(map['Target Price']);
  const earningsDate = map['Earnings'] || null;
  const salesTTM = parseNumber(map['Sales']);
  const salesQQ = parseNumber(map['Sales Q/Q']);
  const epsQQ = parseNumber(map['EPS Q/Q']);
  const income = parseNumber(map['Income']);
  const grossMargin = parseNumber(map['Gross Margin']);
  const operMargin = parseNumber(map['Oper. Margin']);
  const profitMargin = parseNumber(map['Profit Margin']);
  const roe = parseNumber(map['ROE']);
  const debtEq = parseNumber(map['Debt/Eq']);
  const marketCap = map['Market Cap'] || null;

  const estimatedExpenses = salesTTM !== null && income !== null ? salesTTM - income : null;
  const estimatedOperatingExpenses =
    salesTTM !== null && grossMargin !== null && operMargin !== null
      ? salesTTM * ((grossMargin - operMargin) / 100)
      : null;

  const finvizUrl = `https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}&p=d`;
  const fairValueAnalyst = targetPrice;

  const MIN_MULTIPLE = 10;
  const MAX_MULTIPLE = 35;
  let qualityBonus = 0;
  if (roe !== null && roe > 20) qualityBonus += 5;
  if (profitMargin !== null && profitMargin > 20) qualityBonus += 3;
  if (debtEq !== null && debtEq < 0.5) qualityBonus += 2;

  let adjustedMultiple = null;
  if (eps5Y !== null && eps5Y > 0) {
    adjustedMultiple = Math.min(MAX_MULTIPLE, Math.max(MIN_MULTIPLE, eps5Y + qualityBonus));
  }
  let blendedEPS = null;
  if (epsTTM !== null) {
    blendedEPS = epsNextY !== null ? (epsTTM + epsTTM * (1 + epsNextY / 100)) / 2 : epsTTM;
  }
  let fairValueSelf = null;
  if (blendedEPS !== null && adjustedMultiple !== null) {
    fairValueSelf = blendedEPS * adjustedMultiple;
  }
  let forwardMultipleGapPct = null;
  if (forwardPE !== null && forwardPE > 0 && adjustedMultiple !== null) {
    forwardMultipleGapPct = ((adjustedMultiple - forwardPE) / forwardPE) * 100;
  }
  let forecastPrice1Y = null;
  if (price !== null && epsNextY !== null) {
    forecastPrice1Y = price * (1 + epsNextY / 100);
  }
  const upsideAnalystPct = price && fairValueAnalyst ? ((fairValueAnalyst - price) / price) * 100 : null;
  const upsideSelfPct = price && fairValueSelf ? ((fairValueSelf - price) / price) * 100 : null;
  let avgUpsidePct = null;
  const upsides = [upsideAnalystPct, upsideSelfPct].filter((v) => v !== null);
  if (upsides.length) avgUpsidePct = upsides.reduce((a, b) => a + b, 0) / upsides.length;
  const modelDisagreement =
    upsideAnalystPct !== null && upsideSelfPct !== null && Math.abs(upsideAnalystPct - upsideSelfPct) > 40;

  let score = 0;
  if (avgUpsidePct !== null) score += avgUpsidePct;
  if (eps5Y !== null) score += eps5Y * 0.3;
  else score -= 10;
  if (peTTM !== null && peTTM > 0 && peTTM < 40) score += 5;
  else score -= 15;
  if (forwardMultipleGapPct !== null) score += forwardMultipleGapPct * 0.05;
  if (modelDisagreement) score -= 10;

  const missingFields = [];
  if (peTTM === null) missingFields.push('P/E');
  if (eps5Y === null) missingFields.push('צמיחה 5Y');
  if (fairValueSelf === null) missingFields.push('מחיר הוגן עצמי');
  if (fairValueAnalyst === null) missingFields.push('יעד אנליסטים');

  return {
    ticker,
    companyName,
    price,
    peTTM,
    forwardPE,
    epsTTM,
    epsNextY,
    eps5Y,
    roe,
    debtEq,
    salesTTM,
    salesQQ,
    epsQQ,
    netIncomeTTM: income,
    estimatedExpenses,
    estimatedOperatingExpenses,
    grossMargin,
    operMargin,
    profitMargin,
    marketCap,
    earningsDate,
    finvizUrl,
    fairValueAnalyst,
    fairValueSelf,
    forecastPrice1Y,
    upsideAnalystPct,
    upsideSelfPct,
    avgUpsidePct,
    modelDisagreement,
    score,
    dataComplete: missingFields.length === 0,
    missingFields,
    news,
  };
}

async function fetchStockAnalysisFinancials(ticker) {
  const url = `https://stockanalysis.com/stocks/${encodeURIComponent(ticker)}/financials/?p=quarterly`;
  const resp = await fetch(url, { headers: FINVIZ_HEADERS });
  if (!resp.ok) throw new Error(`StockAnalysis HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);
  const table = $('table').first();
  const periods = [];
  table.find('thead tr th').each((i, th) => {
    if (i === 0) return;
    const label = $(th).text().trim();
    if (label) periods.push(label);
  });
  const rows = {};
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((__, td) => $(td).text().trim())
      .get();
    if (!cells.length) return;
    rows[cells[0]] = cells.slice(1);
  });
  function findRow(patterns) {
    const key = Object.keys(rows).find((k) => patterns.some((p) => k.toLowerCase().includes(p)));
    return key ? rows[key] : null;
  }
  function toNumbers(row) {
    if (!row) return null;
    return row.map((v) => {
      if (!v || v === '-') return null;
      const negParen = v.match(/^\((.*)\)$/);
      const cleaned = (negParen ? negParen[1] : v).replace(/[,$%]/g, '');
      const num = parseFloat(cleaned);
      if (isNaN(num)) return null;
      return negParen ? -num : num;
    });
  }
  const revenueRow = findRow(['revenue']);
  const opexRow = findRow(['operating expenses']);
  const netIncomeRow = findRow(['net income']);
  if (!revenueRow) throw new Error('לא נמצאה שורת הכנסות בעמוד - ייתכן שמבנה האתר השתנה');
  return {
    ticker,
    periods,
    revenue: toNumbers(revenueRow),
    operatingExpenses: toNumbers(opexRow),
    netIncome: toNumbers(netIncomeRow),
    sourceUrl: url,
  };
}

async function fetchHistoricalPE(ticker) {
  const url = `https://stockanalysis.com/stocks/${encodeURIComponent(ticker)}/financials/ratios/?p=quarterly`;
  const resp = await fetch(url, { headers: FINVIZ_HEADERS });
  if (!resp.ok) throw new Error(`StockAnalysis ratios HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);
  const table = $('table').first();
  const rows = {};
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((__, td) => $(td).text().trim())
      .get();
    if (!cells.length) return;
    rows[cells[0]] = cells.slice(1);
  });
  const peKey = Object.keys(rows).find((k) => k.toLowerCase().includes('pe ratio'));
  if (!peKey) throw new Error('לא נמצאה שורת P/E בעמוד היחסים');
  const values = rows[peKey]
    .map((v) => {
      if (!v || v === '-') return null;
      const cleaned = v.replace(/[,x]/gi, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    })
    .filter((v) => v !== null && v > 0 && v < 200);
  if (!values.length) throw new Error('אין ערכי P/E היסטוריים תקינים');
  const avgHistoricalPE = values.reduce((a, b) => a + b, 0) / values.length;
  return { avgHistoricalPE, periodsUsed: values.length, sourceUrl: url };
}

// ---------- SEC EDGAR ----------

let tickerCikMap = null;

async function getCikForTicker(ticker, secUserAgent) {
  if (!tickerCikMap) {
    const resp = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: secHeaders(secUserAgent),
    });
    if (!resp.ok) throw new Error(`SEC ticker map HTTP ${resp.status}`);
    const data = await resp.json();
    tickerCikMap = {};
    Object.values(data).forEach((row) => {
      tickerCikMap[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, '0');
    });
  }
  const cik = tickerCikMap[ticker.toUpperCase()];
  if (!cik) throw new Error(`לא נמצא CIK ל-${ticker} ב-SEC`);
  return cik;
}

const GAAP_TAG_CANDIDATES = {
  revenue: [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
  ],
  operatingExpenses: ['OperatingExpenses', 'CostsAndExpenses'],
  netIncome: ['NetIncomeLoss'],
};

function extractSeries(facts, tagCandidates, preferredForms = ['10-Q', '10-K']) {
  const usGaap = (facts && facts.facts && facts.facts['us-gaap']) || {};
  for (const tag of tagCandidates) {
    const concept = usGaap[tag];
    if (!concept || !concept.units || !concept.units.USD) continue;
    const entries = concept.units.USD.filter((e) => {
      if (!preferredForms.includes(e.form)) return false;
      if (!e.start || !e.end) return false;
      const days = (new Date(e.end) - new Date(e.start)) / (1000 * 60 * 60 * 24);
      return days >= 80 && days <= 100;
    });
    if (!entries.length) continue;
    const byEnd = {};
    entries.forEach((e) => {
      if (!byEnd[e.end] || new Date(e.filed) > new Date(byEnd[e.end].filed)) byEnd[e.end] = e;
    });
    const series = Object.values(byEnd).sort((a, b) => new Date(a.end) - new Date(b.end));
    if (series.length) return { tag, series };
  }
  return null;
}

async function fetchSecMetrics(ticker, secUserAgent) {
  const cik = await getCikForTicker(ticker, secUserAgent);
  const resp = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: secHeaders(secUserAgent),
  });
  if (!resp.ok) throw new Error(`SEC companyfacts HTTP ${resp.status}`);
  const facts = await resp.json();
  const revenue = extractSeries(facts, GAAP_TAG_CANDIDATES.revenue);
  const opex = extractSeries(facts, GAAP_TAG_CANDIDATES.operatingExpenses);
  const netIncome = extractSeries(facts, GAAP_TAG_CANDIDATES.netIncome);
  const takeLast = (s, n) =>
    s ? s.series.slice(-n).map((e) => ({ period: e.end, value: e.val, form: e.form })) : null;
  return {
    cik,
    companyName: facts.entityName || ticker,
    revenue: takeLast(revenue, 8),
    operatingExpenses: takeLast(opex, 8),
    netIncome: takeLast(netIncome, 8),
  };
}

async function fetchLatestFilingInfo(cik, secUserAgent) {
  const resp = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: secHeaders(secUserAgent),
  });
  if (!resp.ok) throw new Error(`SEC submissions HTTP ${resp.status}`);
  const data = await resp.json();
  const recent = data.filings && data.filings.recent;
  if (!recent) throw new Error('לא נמצאו דיווחים אחרונים ב-SEC');
  let idx = -1;
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] === '10-Q' || recent.form[i] === '10-K') {
      idx = i;
      break;
    }
  }
  if (idx === -1) throw new Error('לא נמצא דוח 10-K/10-Q אחרון');
  const accession = recent.accessionNumber[idx].replace(/-/g, '');
  const primaryDoc = recent.primaryDocument[idx];
  const cikNum = String(parseInt(cik, 10));
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession}/${primaryDoc}`;
  return { form: recent.form[idx], filingDate: recent.filingDate[idx], reportDate: recent.reportDate[idx], docUrl };
}

/**
 * שולף תמונת מצב פונדמנטלית מלאה למניה אחת (למשל, לרשימת מעקב). לא לשימוש על אוניברסה שלמה.
 */
async function fetchFundamentalsSnapshot(ticker, { secUserAgent } = {}) {
  const finvizParsed = await fetchFinvizQuote(ticker);
  const analysis = buildAnalysis(ticker, finvizParsed);
  await sleep(400);

  let financials = null;
  try {
    financials = await fetchStockAnalysisFinancials(ticker);
    try {
      financials.historicalPE = await fetchHistoricalPE(ticker);
    } catch (e) {
      financials.historicalPE = null;
    }
  } catch (e) {
    financials = { error: e.message };
  }

  let secReport = null;
  try {
    const metrics = await fetchSecMetrics(ticker, secUserAgent);
    const filing = await fetchLatestFilingInfo(metrics.cik, secUserAgent);
    secReport = { metrics, filing };
  } catch (e) {
    secReport = { error: e.message };
  }

  return { ...analysis, financials, secReport, fetchedAt: new Date().toISOString() };
}

module.exports = {
  parseNumber,
  fetchFinvizQuote,
  buildAnalysis,
  fetchStockAnalysisFinancials,
  fetchHistoricalPE,
  fetchFundamentalsSnapshot,
  sleep,
};
