// api/positions.js
// Vercel Serverless Function: GET/POST/DELETE /api/positions
// "פוזיציות פתוחות" שסומנו ידנית - שומר תמונת מצב קפואה (snapshot) של התרחיש בזמן
// שרון נכנס לפוזיציה, כדי שהכניסה/סטופ/יעד יישארו מוצגים גם אם הסריקה היומית הבאה כבר
// לא מזהה תרחיש תקף לאותה מניה (כי המחיר כבר זז מאז שנכנס). בניגוד לרשימת המעקב, שממשיכה
// לחשב מחדש כל יום - כאן הנתונים "ננעלים" בזמן הסימון ולא מתעדכנים.
//
// POST: מסמן פוזיציה חדשה - מקבל את תמונת המצב הנוכחית (symbol + entry/stop/target/...)
//       כפי שמוצגת כבר בטבלת "מועמדים היום" בפרונט-אנד, ושומר אותה כפי שהיא.
// GET:  מחזיר את כל הפוזיציות הפתוחות (closed_at is null).
// DELETE: "סוגר" פוזיציה - מסמן closed_at, לא מוחק (כדי לשמור היסטוריה).

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
      const { rows } = await p.query(
        `select id, symbol, entry, stop, target, add_level, anchored_vwap, wave_a_high,
                current_close, note, opened_at
         from positions where closed_at is null order by opened_at desc`
      );
      res.status(200).json({ positions: rows });
      return;
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const symbol = String(b.symbol || '').trim().toUpperCase();
      if (!symbol) {
        res.status(400).json({ error: 'חסר טיקר' });
        return;
      }
      const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
      const { rows } = await p.query(
        `insert into positions (symbol, entry, stop, target, add_level, anchored_vwap, wave_a_high, current_close, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [
          symbol,
          num(b.entry),
          num(b.stop),
          num(b.target),
          num(b.add_level),
          num(b.anchored_vwap),
          num(b.wave_a_high),
          num(b.current_close),
          b.note ? String(b.note) : null,
        ]
      );
      res.status(200).json({ ok: true, id: rows[0].id });
      return;
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query?.id || req.body?.id);
      if (!id) {
        res.status(400).json({ error: 'חסר מזהה פוזיציה' });
        return;
      }
      await p.query('update positions set closed_at = now() where id = $1 and closed_at is null', [id]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
