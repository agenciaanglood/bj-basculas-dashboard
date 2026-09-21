const SHEET_NAME = 'Actualizaciones';

async function getToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  });
  const { access_token } = await r.json();
  if (!access_token) throw new Error('Auth failed');
  return access_token;
}

async function ensureSheet(sheetId, token) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_NAME + '!A1')}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  if (data.error) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] }),
    });
  }
}

async function getRows(sheetId, token) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_NAME + '!A:D')}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  return data.values || [];
}

function toUpdate(row) {
  return { account: row[0] || '', date: row[1] || '', comment: row[2] || '', createdAt: row[3] || '' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token   = await getToken();
    const sheetId = process.env.SHEET_ID;

    if (req.method === 'GET') {
      const account = req.query.account;
      const limit   = parseInt(req.query.limit) || 0;
      const rows    = await getRows(sheetId, token);
      let updates   = rows.map(toUpdate);
      if (account) updates = updates.filter(u => u.account === account);
      updates.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
      if (limit) updates = updates.slice(0, limit);
      return res.status(200).json({ updates });
    }

    if (req.method === 'POST') {
      const { account, date, comment } = req.body;
      if (!account || !date || !comment) {
        return res.status(400).json({ error: 'account, date y comment son requeridos' });
      }
      await ensureSheet(sheetId, token);
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_NAME + '!A:D')}:append?valueInputOption=RAW`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[account, date, comment, new Date().toISOString()]] }),
        }
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
