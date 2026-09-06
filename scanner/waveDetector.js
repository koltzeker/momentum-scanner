// waveDetector.js
// זיהוי תרחיש מומנטום Wave A / Wave B ברמה יומית.
// זהו פורט ל-JS של הלוגיקה מ-momentum_wave.pine (הפונקציה calcSetup, מסלול ה-Daily,
// isDaily=true) - אותה מתודולוגיה בדיוק כמו ב-RKY MON, מותאמת לנרות יומיים.
//
// שינוי מהמקור בפיין-סקריפט: VWAP תוך-יומי (שמתאפס כל יום) הוחלף ב-VWAP מעוגן
// (anchored VWAP) שמחושב מיום הפיבוט של Wave A קדימה - זו הייתה החלטה מפורשת של רון,
// כי VWAP קלאסי הוא מושג תוך-יומי ולא קיים בגרסה יומית.
//
// מוסכמת אינדקסים: bars הוא מערך מהישן לחדש (bars[bars.length-1] = הנר האחרון/היום).
// back(i) מחזיר את הנר i ימים אחורה מהאחרון, בדיוק כמו high[i] ב-Pine.

'use strict';

const DEFAULTS = {
  stopBuf: 0.03,      // Stop Buffer ($) - כמו i_stopBuf
  targetPct: 15.0,    // יעד מינימלי (%) - כמו i_target
  lookback: 14,       // ימים אחורה ל-Daily - כמו i_lookback
  waveBBars: 2,       // מינימום נרות לגל B - כמו i_waveBBars
};

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/**
 * מזהה תרחיש מומנטום יומי (Wave A/B) על סמך מערך נרות יומיים.
 * @param {Array<{date:string, high:number, low:number, close:number, volume:number}>} bars
 *        מהישן לחדש, הנר האחרון = היום/הנר האחרון שנסגר.
 * @param {Partial<typeof DEFAULTS>} opts
 * @returns {object} תוצאת הזיהוי - ראה שדות למטה.
 */
function detectDailySetup(bars, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const n = bars.length;
  const minNeeded = cfg.lookback * 2 + cfg.waveBBars + 2;
  if (n < minNeeded) {
    return { valid: false, reason: 'insufficient_data', barsAvailable: n, barsNeeded: minNeeded };
  }

  const currentClose = bars[n - 1].close;
  const lbBars = Math.max(2, cfg.lookback);
  const back = (i) => bars[n - 1 - i];
  const volumesOldToNew = bars.map((b) => b.volume);

  // ── גל A: שיא lbBars ימים אחורה ──
  let rawHigh = -Infinity;
  let rawLow = Infinity;
  for (let i = 0; i < lbBars && n - 1 - i >= 0; i++) {
    rawHigh = Math.max(rawHigh, back(i).high);
    rawLow = Math.min(rawLow, back(i).low);
  }

  // סינון שיא הזוי: לא יכול לחרוג פי 1.5 מהמחיר הנוכחי (או פחות מחצי ממנו)
  const wAHigh = rawHigh >= currentClose * 0.5 && rawHigh <= currentClose * 1.5 ? rawHigh : null;

  // מתי נוצר השיא (כמה ימים אחורה)
  let wAHighOff = 0;
  if (wAHigh !== null) {
    for (let i = 0; i < lbBars; i++) {
      if (back(i).high >= wAHigh * 0.999) {
        wAHighOff = i;
        break;
      }
    }
  }

  // גל A תקף רק אם עברו מספיק ימים מאז השיא כדי שגל B יספיק להיווצר
  const wAValid = wAHigh !== null && wAHighOff >= cfg.waveBBars;

  // ── גל B: השפל מאז שיא גל A ──
  let wBLow = null;
  let wBValid = false;

  if (wAValid) {
    let bLow = wAHigh;
    let bVolSum = 0;
    let bCount = 0;
    for (let i = 0; i < wAHighOff; i++) {
      const bar = back(i);
      if (bar.low < bLow) bLow = bar.low;
      bVolSum += bar.volume;
      bCount += 1;
    }

    // נפח "גל A" - התקופה שלפני השיא, לצורך השוואה (לא בשימוש בפועל ב-Daily, ראו s3)
    let aVolSum = 0;
    let aCount = 0;
    const aEnd = Math.min(wAHighOff + lbBars - 1, lbBars * 2 - 1);
    for (let i = wAHighOff; i <= aEnd && n - 1 - i >= 0; i++) {
      aVolSum += back(i).volume;
      aCount += 1;
    }
    const bAvgVol = bCount > 0 ? bVolSum / bCount : null;
    const aAvgVol = aCount > 0 ? aVolSum / aCount : sma(volumesOldToNew, 50);

    if (bAvgVol !== null && bCount >= cfg.waveBBars) {
      const s1 = bLow < wAHigh * 0.995; // מתחת לגל A משמעותית
      const s2 = bLow >= wAHigh * 0.55; // לא ירידה של יותר מ-45%
      const s3 = true; // ב-Daily לא בודקים ירידת נפח בגל B (isDaily=true במקור)
      const s4 = bLow >= currentClose * 0.6; // הגיוני ביחס למחיר עכשיו
      const s5 = bLow <= currentClose * 1.25;
      void aAvgVol; // נשמר לצורך תיעוד/דיבוג בלבד, לא משפיע על s3 ב-Daily
      if (s1 && s2 && s3 && s4 && s5) {
        wBLow = bLow;
        wBValid = true;
      }
    }
  }

  const bValid = wBValid && wAValid;

  // Stop היסטורי (רמה משנית/אינפורמטיבית) - שפל lbBars אם נמוך משפל גל B
  const histLow = rawLow >= currentClose * 0.5 && rawLow <= currentClose * 1.5 ? rawLow : null;
  const stopHist =
    bValid && histLow !== null && wBLow !== null && histLow < wBLow ? histLow - cfg.stopBuf : null;

  const entry = bValid ? wBLow + cfg.stopBuf * 3 : null;
  const stop = bValid ? wBLow - cfg.stopBuf : null;
  const target = bValid ? entry * (1 + cfg.targetPct / 100) : null;
  const addLevel = bValid ? wAHigh + cfg.stopBuf : null;

  // ── VWAP מעוגן (anchored) מנקודת שיא גל A קדימה עד היום - תחליף ל-VWAP התוך-יומי ──
  let anchoredVwap = null;
  if (wAValid) {
    let pv = 0;
    let v = 0;
    for (let i = wAHighOff; i >= 0; i--) {
      const bar = back(i);
      const typical = (bar.high + bar.low + bar.close) / 3;
      pv += typical * bar.volume;
      v += bar.volume;
    }
    anchoredVwap = v > 0 ? pv / v : null;
  }

  const aboveWaveB = wBLow !== null && currentClose > wBLow;
  const aboveVwap = anchoredVwap !== null && currentClose > anchoredVwap;
  const entryNotMissed = entry === null || currentClose <= entry * 1.05;

  const valid =
    bValid &&
    entry !== null &&
    entry > stop &&
    target > entry &&
    currentClose >= stop &&
    aboveWaveB &&
    aboveVwap &&
    entryNotMissed;

  return {
    valid,
    reason: valid ? 'ok' : bValid ? 'conditions_not_met' : 'no_wave_setup',
    date: bars[n - 1].date,
    currentClose,
    waveAHigh: wAHigh,
    waveAHighDaysAgo: wAValid ? wAHighOff : null,
    waveBLow: wBLow,
    entry,
    stop,
    stopHist,
    target,
    addLevel,
    anchoredVwap,
    aboveWaveB,
    aboveVwap,
    entryNotMissed,
  };
}

module.exports = { detectDailySetup, DEFAULTS };
