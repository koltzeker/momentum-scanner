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

    const latestDateRes = await p.query('select max(scan_date) as d from momentum_setups');
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

    res.status(200).json({
      scanDate: scanDate || null,
      candidates: candidatesRes.rows,
      watchlist: watchlistRes.rows,
      recentRuns: lastRunRes.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
