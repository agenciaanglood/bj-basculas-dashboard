const SHEET_NAME = 'Presupuestos';

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
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_NAME + '!A:B')}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  return data.values || [];
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
      const rows    = await getRows(sheetId, token);
      const row     = rows.find(r => r[0] === account);
      return res.status(200).json({ budget: row ? parseFloat(row[1]) || 0 : 0 });
    }

    if (req.method === 'POST') {
      const { account, budget } = req.body;
      await ensureSheet(sheetId, token);
      const rows   = await getRows(sheetId, token);
      const rowIdx = rows.findIndex(r => r[0] === account);

      if (rowIdx === -1) {
        // Append new row
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_NAME + '!A:B')}:append?valueInputOption=RAW`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[account, budget]] }),
          }
        );
      } else {
        // Update existing row
        const range = encodeURIComponent(`${SHEET_NAME}!A${rowIdx + 1}:B${rowIdx + 1}`);
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[account, budget]] }),
          }
        );
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
