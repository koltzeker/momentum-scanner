// api/watchlist.js
// Vercel Serverless Function: GET/POST/DELETE /api/watchlist
// ניהול רשימת המעקב האישית - בדיוק כמו כפתורי ההוספה/הסרה בהייפ, רק שהנתונים נשמרים ב-DB
// המשותף במקום ב-localStorage, כדי שיהיו זמינים גם מהסקריפט שרץ ב-GitHub Actions.

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const p = getPool();

  try {
    if (req.method === 'GET') {
      const { rows } = await p.query('select symbol, note, added_at from watchlist order by added_at desc');
      res.status(200).json({ watchlist: rows });
      return;
    }

    if (req.method === 'POST') {
      const symbol = String(req.body?.symbol || '').trim().toUpperCase();
      const note = req.body?.note ? String(req.body.note) : null;
      if (!symbol) {
        res.status(400).json({ error: 'חסר טיקר' });
        return;
      }
      await p.query(
        `insert into tickers (symbol, name, indices, active) values ($1, $1, '{}', true)
         on conflict (symbol) do nothing`,
        [symbol]
      );
      await p.query(
        `insert into watchlist (symbol, note) values ($1, $2)
         on conflict (symbol) do update set note=$2`,
        [symbol, note]
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const symbol = String(req.query?.symbol || req.body?.symbol || '').trim().toUpperCase();
      if (!symbol) {
        res.status(400).json({ error: 'חסר טיקר' });
        return;
      }
      await p.query('delete from watchlist where symbol=$1', [symbol]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
