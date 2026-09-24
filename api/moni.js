// api/moni.js
// Vercel Serverless Function: /api/moni?action=login|logout|data
// עמוד "מוני" מוגן בסיסמה משותפת אחת (MONI_PASSWORD, Environment Variable ב-Vercel
// שרון מגדיר בעצמו - ראו scanner/moniAuth.js). כתובת יחידה עם ניתוב לפי query כדי
// לצמצם את מספר הפונקציות (מגבלת Vercel Hobby: 12 serverless functions לפריסה).
//
// action=login (POST {password}): מאמת מול MONI_PASSWORD, קובע עוגיית HttpOnly.
// action=logout (POST): מוחק את העוגייה.
// action=data (GET/POST, ברירת מחדל): קריאה/כתיבה של כל מצב מוני (פוזיציות, ווטצ'ליסט,
//   פוזיציות שזוהו מהצ'אט, תוכניות שמורות, היסטוריית שיחה, תוכנית יומית) - כמו הקובץ
//   המקומי moni_data.json בגרסה הישנה, רק שנשמר ב-Postgres.

const { requireAuth, login, setAuthCookie, COOKIE_NAME } = require('../scanner/moniAuth');
const { loadMoniState, saveMoniState } = require('../scanner/moniStore');

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || 'data';

  if (action === 'login') {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }
    const { password } = req.body || {};
    const r = login(password);
    if (!r.ok) {
      if (r.reason === 'not_configured') {
        res.status(500).json({
          error: 'MONI_PASSWORD לא מוגדר ב-Vercel. יש להגדיר Environment Variable בשם MONI_PASSWORD ולפרוס מחדש.',
        });
      } else {
        res.status(401).json({ error: 'סיסמה שגויה' });
      }
      return;
    }
    setAuthCookie(res, r.token);
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.status(200).json({ ok: true });
    return;
  }

  if (action !== 'data') {
    res.status(400).json({ error: 'unknown action' });
    return;
  }

  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const data = await loadMoniState();
      res.status(200).json(data);
      return;
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      await saveMoniState(body);
      res.status(200).send('ok');
      return;
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
