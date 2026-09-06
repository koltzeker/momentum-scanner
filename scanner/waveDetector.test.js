// בדיקת סניטי ידנית ל-waveDetector, על נתונים סינתטיים (בלי תלות ברשת).
// מריצים עם: node scanner/waveDetector.test.js

const { detectDailySetup } = require('./waveDetector');
const assert = require('assert');

function mkBar(date, high, low, close, volume) {
  return { date, high, low, close, volume };
}

// תרחיש 1: מבנה Wave A -> Wave B -> ריקאברי תקין, אמור לצאת valid=true
function buildValidScenario() {
  const bars = [];
  let day = 1;
  // רצפת בסיס לפני התחלת התרחיש (נדרש מינימום lookback*2+waveBBars+2 = 32 נרות סה"כ)
  for (let i = 0; i < 30; i++) {
    bars.push(mkBar(`d${day++}`, 10 + i * 0.05, 9.8 + i * 0.05, 9.9 + i * 0.05, 500000));
  }
  // Wave A: עלייה לשיא ב-$14 לפני 8 ימים (offset=8 מהסוף אחרי שנוסיף עוד נתונים)
  bars.push(mkBar(`d${day++}`, 14.0, 13.5, 13.9, 900000)); // יום השיא - Wave A high
  // Wave B: ירידה למשך כמה ימים
  bars.push(mkBar(`d${day++}`, 13.6, 12.5, 12.6, 700000));
  bars.push(mkBar(`d${day++}`, 12.7, 11.2, 11.4, 650000)); // שפל גל B בערך כאן
  bars.push(mkBar(`d${day++}`, 11.8, 11.1, 11.6, 400000));
  bars.push(mkBar(`d${day++}`, 12.0, 11.5, 11.9, 420000));
  // ריקאברי: נר ירוק שסוגר מעל השפל ומעל ה-VWAP המעוגן, בלי לרדוף (לא +5% מעל entry)
  bars.push(mkBar(`d${day++}`, 12.3, 11.9, 12.2, 600000));
  return bars;
}

const validBars = buildValidScenario();
const result = detectDailySetup(validBars, { lookback: 14, waveBBars: 2, stopBuf: 0.03, targetPct: 15 });
console.log('תרחיש 1 (אמור להיות valid):', JSON.stringify(result, null, 2));
assert.ok(result.waveAHigh !== null, 'ציפינו לזהות שיא Wave A');
assert.ok(result.waveBLow !== null, 'ציפינו לזהות שפל Wave B');
assert.ok(result.entry > result.stop, 'entry חייב להיות מעל stop');
assert.ok(result.target > result.entry, 'target חייב להיות מעל entry');

// תרחיש 2: אין מספיק נתונים בכלל -> insufficient_data
const shortBars = validBars.slice(-5);
const result2 = detectDailySetup(shortBars);
console.log('\nתרחיש 2 (אין מספיק נתונים):', result2);
assert.strictEqual(result2.valid, false);
assert.strictEqual(result2.reason, 'insufficient_data');

// תרחיש 3: מחיר שטוח לגמרי - אין שום תנועה, לא אמור לזהות תרחיש
const flatBars = [];
for (let i = 0; i < 40; i++) flatBars.push(mkBar(`f${i}`, 10, 9.95, 10, 300000));
const result3 = detectDailySetup(flatBars);
console.log('\nתרחיש 3 (שוק שטוח - אין תרחיש):', result3.valid, result3.reason);
assert.strictEqual(result3.valid, false);

console.log('\n✅ כל הבדיקות עברו');
