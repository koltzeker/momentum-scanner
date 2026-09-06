// api/trigger-full-scan.js
// Vercel Serverless Function: POST /api/trigger-full-scan
// כפתור "סרוק הכל עכשיו" בפרונט-אנד - במקום להריץ את הסריקה המלאה (מאות טיקרים, ארוכה
// מדי לפונקציית Vercel) בתוך הפונקציה עצמה, זה רק "מצית" את ה-GitHub Action של הסריקה
// היומית להרצה מיידית (workflow_dispatch), והיא רצה שם ברקע.
//
// דורש שני משתני סביבה נוספים ב-Vercel:
//   GITHUB_TOKEN  - Personal Access Token עם הרשאת "Actions: write" על הריפו
//   GITHUB_REPO   - "owner/repo", למשל "ron-username/momentum-scanner"

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    res.status(500).json({ error: 'חסרים GITHUB_TOKEN / GITHUB_REPO בהגדרות הסביבה של Vercel' });
    return;
  }

  try {
    const resp = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/daily-scan.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (resp.status !== 204) {
      const text = await resp.text();
      res.status(502).json({ error: `GitHub API החזיר ${resp.status}: ${text}` });
      return;
    }
    res.status(200).json({ ok: true, message: 'הסריקה המלאה הופעלה ב-GitHub Actions, תיקח כמה דקות.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
