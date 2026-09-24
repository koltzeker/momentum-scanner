// api/moni-chat.js
// Vercel Serverless Function: POST /api/moni-chat  body: { messages, context }
// פורט של POST /chat מ-MONEY/server.js (הגרסה המקומית הישנה). ההבדל המרכזי מהמקור:
// מפתח ה-Anthropic API כבר לא מגיע מהלקוח (body.apiKey) - הוא נלקח מ-process.env.
// ANTHROPIC_API_KEY, משתנה סביבה שרון מגדיר בעצמו ב-Vercel. אם הוא לא מוגדר, מוחזרת
// שגיאה ברורה במקום קריאה ל-Anthropic עם מפתח ריק.

const { requireAuth } = require('../scanner/moniAuth');
const { loadMoniState, saveMoniState } = require('../scanner/moniStore');
const { buildFullContext, callClaude } = require('../scanner/moniAgent');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY לא מוגדר ב-Vercel. יש להגדיר Environment Variable ולפרוס מחדש.' });
    return;
  }

  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: 'messages חסר' });
    return;
  }

  try {
    const savedData = await loadMoniState();
    const fullContext = buildFullContext(context, savedData);
    const reply = await callClaude(apiKey, messages, fullContext);

    // זיהוי פקודת פוזיציה בהודעה האחרונה של המשתמש ושמירה אוטומטית (כמו במקור)
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    const posMatch = lastUserMsg.match(/נכנסתי\s+(?:ל)?([A-Z]+)\s+(\d+)\s+מניות?\s+[בב$]?\$?([\d.]+)/i);
    if (posMatch) {
      const [, sym, qty, entry] = posMatch;
      const stopMatch = lastUserMsg.match(/stop\s+[בב$]?\$?([\d.]+)/i);
      const stop = stopMatch ? parseFloat(stopMatch[1]) : null;
      savedData.positions = savedData.positions || [];
      const idx = savedData.positions.findIndex((p) => p.sym === sym.toUpperCase());
      const pos = { sym: sym.toUpperCase(), qty: parseInt(qty, 10), entry: parseFloat(entry), stop, ts: new Date().toISOString() };
      if (idx >= 0) savedData.positions[idx] = pos;
      else savedData.positions.push(pos);
    }

    // שמירת תוכנית יומית אם הסוכן כתב אחת (כמו במקור)
    if (reply.includes('תוכנית יום') || reply.includes('תוכנית לאחר')) {
      savedData.dailyPlan = { plan: reply, date: new Date().toLocaleDateString('he-IL'), ts: new Date().toISOString() };
    }

    await saveMoniState(savedData);

    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
