// db.js
// עטיפה דקה סביב Postgres (מתאים גם ל-Supabase וגם ל-Neon - שניהם Postgres רגיל).
// כתובת החיבור מגיעה ממשתנה סביבה DATABASE_URL (מוגדר כ-secret ב-GitHub Actions
// ובספק האחסון של הפרונט-אנד).

'use strict';

const { Pool } = require('pg');

let pool = null;
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('חסר משתנה סביבה DATABASE_URL - ראו README להגדרת ה-secret.');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // נדרש ע"י רוב ספקי ה-Postgres המתארחים
    });
  }
  return pool;
}

async function upsertTickers(tickers) {
  if (!tickers.length) return;
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('begin');
    const chunkSize = 200; // כמה שורות בכל INSERT מרובה-שורות (נמנעים מאות round-trips נפרדים)
    for (let i = 0; i < tickers.length; i += chunkSize) {
      const chunk = tickers.slice(i, i + chunkSize);
      const values = [];
      const params = [];
      chunk.forEach((t, idx) => {
        const base = idx * 3;
        values.push(`($${base + 1},$${base + 2},$${base + 3},true,now())`);
        params.push(t.symbol, t.name, t.indices);
      });
      await client.query(
        `insert into tickers (symbol, name, indices, active, updated_at)
         values ${values.join(',')}
         on conflict (symbol) do update set name=excluded.name, indices=excluded.indices, active=true, updated_at=now()`,
        params
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

async function getActiveSymbols() {
  const p = getPool();
  const { rows } = await p.query('select symbol from tickers where active=true order by symbol');
  return rows.map((r) => r.symbol);
}

async function getWatchlist() {
  const p = getPool();
  const { rows } = await p.query('select symbol, note, added_at from watchlist order by added_at desc');
  return rows;
}

async function addToWatchlist(symbol, note = null) {
  const p = getPool();
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
}

async function removeFromWatchlist(symbol) {
  const p = getPool();
  await p.query('delete from watchlist where symbol=$1', [symbol]);
}

async function saveDailyBars(symbol, bars) {
  if (!bars.length) return;
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('begin');
    // חשוב לביצועים: INSERT מרובה-שורות במקום שאילתה נפרדת לכל נר. עם ~250 נרות לכל
    // טיקר ו-500+ טיקרים בסריקה, שאילתה בודדת לכל נר (round-trip נפרד לרשת) הפכה את
    // הסריקה לאיטית מדי (חורגת בהרבה מהזמן המשוער ומזמן ה-timeout של ה-Action).
    const chunkSize = 200;
    for (let i = 0; i < bars.length; i += chunkSize) {
      const chunk = bars.slice(i, i + chunkSize);
      const values = [];
      const params = [];
      chunk.forEach((b, idx) => {
        const base = idx * 6;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`);
        params.push(symbol, b.date, b.high, b.low, b.close, b.volume);
      });
      await client.query(
        `insert into daily_bars (symbol, bar_date, high, low, close, volume)
         values ${values.join(',')}
         on conflict (symbol, bar_date) do update set high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume`,
        params
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

async function getDailyBars(symbol, limit = 400) {
  const p = getPool();
  const { rows } = await p.query(
    `select bar_date as date, high, low, close, volume from daily_bars
     where symbol=$1 order by bar_date asc
     offset greatest(0, (select count(*) from daily_bars where symbol=$1) - $2)`,
    [symbol, limit]
  );
  return rows.map((r) => ({
    date: r.date.toISOString ? r.date.toISOString().slice(0, 10) : r.date,
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }));
}

async function saveMomentumSetup(symbol, scanDate, setup) {
  const p = getPool();
  await p.query(
    `insert into momentum_setups
      (symbol, scan_date, valid, reason, current_close, wave_a_high, wave_a_high_days_ago,
       wave_b_low, entry, stop, stop_hist, target, add_level, anchored_vwap)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (symbol, scan_date) do update set
       valid=$3, reason=$4, current_close=$5, wave_a_high=$6, wave_a_high_days_ago=$7,
       wave_b_low=$8, entry=$9, stop=$10, stop_hist=$11, target=$12, add_level=$13, anchored_vwap=$14`,
    [
      symbol,
      scanDate,
      setup.valid,
      setup.reason,
      setup.currentClose,
      setup.waveAHigh,
      setup.waveAHighDaysAgo,
      setup.waveBLow,
      setup.entry,
      setup.stop,
      setup.stopHist,
      setup.target,
      setup.addLevel,
      setup.anchoredVwap,
    ]
  );
}

async function saveFundamentalsSnapshot(symbol, data) {
  const p = getPool();
  await p.query(
    `insert into fundamentals_snapshot (symbol, data, fetched_at) values ($1,$2, now())
     on conflict (symbol) do update set data=$2, fetched_at=now()`,
    [symbol, data]
  );
}

async function logScanRun(runType) {
  const p = getPool();
  const { rows } = await p.query(
    `insert into scan_runs (run_type, started_at, status) values ($1, now(), 'running') returning id`,
    [runType]
  );
  return rows[0].id;
}

async function finishScanRun(id, { symbolsCount, validCount, status, errorMessage }) {
  const p = getPool();
  await p.query(
    `update scan_runs set finished_at=now(), symbols_count=$2, valid_count=$3, status=$4, error_message=$5
     where id=$1`,
    [id, symbolsCount, validCount, status, errorMessage || null]
  );
}

module.exports = {
  getPool,
  upsertTickers,
  getActiveSymbols,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  saveDailyBars,
  getDailyBars,
  saveMomentumSetup,
  saveFundamentalsSnapshot,
  logScanRun,
  finishScanRun,
};
