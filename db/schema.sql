-- סכמת DB למערכת איתור המומנטום היומי.
-- מתאים ל-Postgres מתארח (Supabase / Neon) - להריץ פעם אחת דרך ה-SQL editor שלהם.

create table if not exists tickers (
  symbol      text primary key,
  name        text,
  indices     text[] not null default '{}',   -- למשל {SP500,NDX100}
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- מטמון נרות יומיים - נשמר כדי לא לשלוף מ-Yahoo מחדש בכל הרצה, ולאפשר בק-טסט מהיר.
create table if not exists daily_bars (
  symbol      text not null references tickers(symbol) on delete cascade,
  bar_date    date not null,
  high        numeric not null,
  low         numeric not null,
  close       numeric not null,
  volume      bigint not null,
  primary key (symbol, bar_date)
);
create index if not exists idx_daily_bars_symbol_date on daily_bars(symbol, bar_date desc);

-- תוצאות הסריקה היומית - תרחיש Wave A/B לכל טיקר, נכתב מחדש כל יום.
create table if not exists momentum_setups (
  symbol           text not null references tickers(symbol) on delete cascade,
  scan_date        date not null,
  valid            boolean not null,
  reason           text,
  current_close    numeric,
  wave_a_high      numeric,
  wave_a_high_days_ago integer,
  wave_b_low       numeric,
  entry            numeric,
  stop             numeric,
  stop_hist        numeric,
  target           numeric,
  add_level        numeric,
  anchored_vwap    numeric,
  created_at       timestamptz not null default now(),
  primary key (symbol, scan_date)
);
create index if not exists idx_momentum_setups_scan_date on momentum_setups(scan_date desc, valid desc);

-- רשימת המעקב האישית של רון (מוזנת/מנוהלת דרך הפרונט-אנד).
create table if not exists watchlist (
  symbol      text primary key references tickers(symbol) on delete cascade,
  note        text,
  added_at    timestamptz not null default now()
);

-- תמונת מצב פונדמנטלית אחרונה לכל מניה ברשימת המעקב (מ-fundamentals.js, בסגנון הייפ).
create table if not exists fundamentals_snapshot (
  symbol        text primary key references tickers(symbol) on delete cascade,
  data          jsonb not null,   -- כל האובייקט שמחזיר fetchFundamentalsSnapshot
  fetched_at    timestamptz not null default now()
);

-- לוג הרצות הסריקה (לצורך דיבוג/ניטור מתי הרצה האחרונה הצליחה)
create table if not exists scan_runs (
  id            bigserial primary key,
  run_type      text not null,       -- 'daily_scan' | 'update_universe' | 'manual_refresh'
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  symbols_count integer,
  valid_count   integer,
  status        text,               -- 'ok' | 'error'
  error_message text
);
