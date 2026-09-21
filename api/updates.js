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

async function getSheetInternalId(sheetId, token) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  const sheet = (data.sheets || []).find(s => s.properties.title === SHEET_NAME);
  return sheet ? sheet.properties.sheetId : null;
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
  return { account: row[0] || '', date: row[1] || '', comment: row[2] || '', id: row[3] || '' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
      updates.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
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

    if (req.method === 'PUT') {
      const { account, id, date, comment } = req.body;
      if (!account || !id || !date || !comment) {
        return res.status(400).json({ error: 'account, id, date y comment son requeridos' });
      }
      const rows   = await getRows(sheetId, token);
      const rowIdx = rows.findIndex(r => r[0] === account && r[3] === id);
      if (rowIdx === -1) return res.status(404).json({ error: 'Actualización no encontrada' });

      const range = encodeURIComponent(`${SHEET_NAME}!A${rowIdx + 1}:D${rowIdx + 1}`);
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[account, date, comment, id]] }),
        }
      );
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const account = req.query.account;
      const id      = req.query.id;
      if (!account || !id) return res.status(400).json({ error: 'account e id son requeridos' });

      const rows   = await getRows(sheetId, token);
      const rowIdx = rows.findIndex(r => r[0] === account && r[3] === id);
      if (rowIdx === -1) return res.status(404).json({ error: 'Actualización no encontrada' });

      const sheetInternalId = await getSheetInternalId(sheetId, token);
      if (sheetInternalId === null) return res.status(500).json({ error: 'No se encontró la hoja Actualizaciones' });

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetInternalId,
                dimension: 'ROWS',
                startIndex: rowIdx,
                endIndex: rowIdx + 1,
              },
            },
          }],
        }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
