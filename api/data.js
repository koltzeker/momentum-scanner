// api/data.js
// Vercel Serverless Function: GET /api/data
// מחזיר לפרונט-אנד את כל מה שצריך למסך הראשי - מועמדי הסריקה של היום + רשימת המעקב
// עם הפונדמנטלס האחרונים שנשמרו לה.

const { Pool } = require('pg');

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  try {
    const p = getPool();

    // לא פשוט max(scan_date): רענון בודד של מניה (למשל בעת הוספה לרשימת מעקב) כותב שורה
    // אחת עם תאריך של היום, וזה יכול "לעקוף" תאריך יותר ישן שבו כן רצה הסריקה המלאה
    // (מאות שורות) - מה שהיה גורם לטבלת "מועמדים היום" להיראות ריקה. לכן בוחרים את
    // התאריך עם הכי הרבה שורות (הסריקה האמיתית), לא סתם את התאריך המאוחר ביותר.
    const latestDateRes = await p.query(
      `select scan_date as d
       from momentum_setups
       group by scan_date
       order by count(*) desc, scan_date desc
       limit 1`
    );
    const scanDate = latestDateRes.rows[0]?.d;

    const candidatesRes = scanDate
      ? await p.query(
          `select ms.*, t.name from momentum_setups ms
           join tickers t on t.symbol = ms.symbol
           where ms.scan_date = $1 and ms.valid = true
           order by ms.symbol asc`,
          [scanDate]
        )
      : { rows: [] };

    const watchlistRes = await p.query(
      `select w.symbol, w.note, w.added_at,
              fs.data as fundamentals, fs.fetched_at as fundamentals_fetched_at,
              ms.valid as momentum_valid, ms.entry, ms.stop, ms.target, ms.add_level,
              ms.anchored_vwap, ms.current_close, ms.reason, ms.scan_date
       from watchlist w
       left join fundamentals_snapshot fs on fs.symbol = w.symbol
       left join momentum_setups ms on ms.symbol = w.symbol and ms.scan_date = (
         select max(scan_date) from momentum_setups where symbol = w.symbol
       )
       order by w.added_at desc`
    );

    const lastRunRes = await p.query(
      `select run_type, started_at, finished_at, symbols_count, valid_count, status
       from scan_runs order by started_at desc limit 5`
    );

    // עטוף בנפרד: אם טבלת positions עוד לא נוצרה ב-DB (טרם הורצה עדכון הסכמה), לא נרצה
    // שזה יפיל את כל התגובה - רק שהפוזיציות יחזרו ריקות עד שהסכמה תעודכן.
    let positions = [];
    try {
      const positionsRes = await p.query(
        `select id, symbol, entry, stop, target, add_level, anchored_vwap, wave_a_high,
                current_close, note, opened_at
         from positions where closed_at is null order by opened_at desc`
      );
      positions = positionsRes.rows;
    } catch (e) {
      positions = [];
    }

    res.status(200).json({
      scanDate: scanDate || null,
      candidates: candidatesRes.rows,
      watchlist: watchlistRes.rows,
      positions,
      recentRuns: lastRunRes.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
