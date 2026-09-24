// moniStore.js
// אחסון מצב "מוני" ב-Postgres (טבלת moni_state, שורה יחידה id=1) - מחליף את
// moni_data.json שהיה קובץ מקומי בגרסה הישנה שרצה על המחשב האישי של רון.

'use strict';

const { Pool } = require('pg');

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

const DEFAULTS = { positions: [], watchlist: [], dailyPlan: null, hist: [], savedPositions: [], plans: [], disabled: {} };

async function loadMoniState() {
  const p = getPool();
  const { rows } = await p.query('select data from moni_state where id = 1');
  const data = rows[0]?.data || {};
  return { ...DEFAULTS, ...data };
}

async function saveMoniState(data) {
  const p = getPool();
  await p.query(
    `insert into moni_state (id, data, updated_at) values (1, $1, now())
     on conflict (id) do update set data = $1, updated_at = now()`,
    [JSON.stringify(data)]
  );
}

module.exports = { loadMoniState, saveMoniState, DEFAULTS };
