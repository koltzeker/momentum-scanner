// moniAuth.js
// הגנת סיסמה משותפת אחת לעמוד "מוני" (web/moni.html) - אין משתמשים בפועל, רק סיסמה
// אחת שרון בוחר ומגדיר בעצמו כ-MONI_PASSWORD ב-Vercel (Environment Variables), בדיוק
// כמו DATABASE_URL/SEC_USER_AGENT הקיימים כבר. לעולם לא מוזנת/נראית ע"י Claude.
//
// מנגנון: אחרי POST מוצלח ל-/api/moni?action=login עם הסיסמה הנכונה, נשמר עוגיית
// HttpOnly שערכה הוא hash(SHA-256) של הסיסמה עצמה - לא הסיסמה בטקסט גלוי. בכל בקשה
// מוגנת אחרת מחשבים מחדש את אותו hash מ-process.env.MONI_PASSWORD ומשווים
// (timing-safe) לעוגייה. זה מספיק לשימוש אישי יחיד (לא מערכת הרשאות אמיתית) ולא
// דורש טבלת סשנים ב-DB.

'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'moni_auth';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 יום

function expectedToken() {
  const pw = process.env.MONI_PASSWORD;
  if (!pw) return null;
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// true / false / 'not_configured' (MONI_PASSWORD לא הוגדר ב-Vercel בכלל)
function checkAuth(req) {
  const expected = expectedToken();
  if (!expected) return 'not_configured';
  const cookies = parseCookies(req);
  const got = cookies[COOKIE_NAME];
  if (!got || got.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch (e) {
    return false;
  }
}

// שולח 401/500 ומחזיר false אם הבקשה לא מאומתת; שולח כלום ומחזיר true אם כן.
// שימוש: if (!requireAuth(req, res)) return;
function requireAuth(req, res) {
  const state = checkAuth(req);
  if (state === 'not_configured') {
    res.status(500).json({ error: 'MONI_PASSWORD לא מוגדר ב-Vercel. יש להגדיר Environment Variable בשם MONI_PASSWORD ולפרוס מחדש.' });
    return false;
  }
  if (state !== true) {
    res.status(401).json({ error: 'not_authenticated' });
    return false;
  }
  return true;
}

function login(password) {
  const expected = expectedToken();
  if (!expected) return { ok: false, reason: 'not_configured' };
  const real = process.env.MONI_PASSWORD;
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(String(real));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!match) return { ok: false, reason: 'wrong_password' };
  return { ok: true, token: expected };
}

function setAuthCookie(res, token) {
  const secure = process.env.VERCEL ? 'Secure; ' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SEC}`
  );
}

module.exports = { checkAuth, requireAuth, login, setAuthCookie, COOKIE_NAME };
