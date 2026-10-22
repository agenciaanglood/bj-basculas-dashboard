// Tareas (kanban) y plantillas de tareas — guardadas en pestañas de la misma planilla de Google Sheets.
// ?kind=tasks (pestaña "Tareas")  |  ?kind=templates (pestaña "Plantillas")

function safeParse(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }

const KINDS = {
  tasks: {
    title: 'Tareas',
    header: ['id', 'Tarea', 'Solicitada', 'Límite', 'Responsable', 'Cliente', 'Estado', 'Creada', 'Descripción', 'Checklist (JSON)'],
    createdIdx: 7,
    lastCol: 'J',
    toRow: (o, id, created) => [id, o.name || '', o.requested || '', o.due || '', o.assignee || '', o.client || '', o.status === 'concluida' ? 'concluida' : 'abierta', created, o.description || '', JSON.stringify(Array.isArray(o.checklist) ? o.checklist : [])],
    fromRow: r => ({ id: r[0] || '', name: r[1] || '', requested: r[2] || '', due: r[3] || '', assignee: r[4] || '', client: r[5] || '', status: r[6] === 'concluida' ? 'concluida' : 'abierta', description: r[8] || '', checklist: safeParse(r[9]) }),
    valid: o => !!(o && o.name && o.client),
  },
  templates: {
    title: 'Plantillas',
    // Modelo = UNA tarea reutilizable (nombre, descripción, checklist, días para el límite, responsable)
    header: ['id', 'Nombre', 'Descripción', 'Checklist (JSON)', 'Días límite', 'Responsable', 'Creada'],
    createdIdx: 6,
    lastCol: 'G',
    toRow: (o, id, created) => [id, o.name || '', o.description || '', JSON.stringify(Array.isArray(o.checklist) ? o.checklist : []), o.days === '' || o.days == null ? '' : Number(o.days), o.assignee || '', created],
    fromRow: r => ({ id: r[0] || '', name: r[1] || '', description: r[2] || '', checklist: safeParse(r[3]), days: r[4] === undefined || r[4] === '' ? '' : Number(r[4]), assignee: r[5] || '' }),
    valid: o => !!(o && o.name),
  },
};

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

const base = id => `https://sheets.googleapis.com/v4/spreadsheets/${id}`;

async function ensureSheet(sheetId, token, cfg) {
  const auth = { Authorization: `Bearer ${token}` };
  const r = await fetch(`${base(sheetId)}/values/${encodeURIComponent(cfg.title + '!A1')}`, { headers: auth });
  const data = await r.json();
  if (data.error) {
    await fetch(`${base(sheetId)}:batchUpdate`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: cfg.title } } }] }),
    });
    await fetch(`${base(sheetId)}/values/${encodeURIComponent(cfg.title + '!A1')}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [cfg.header] }),
    });
  }
}

async function getRows(sheetId, token, cfg) {
  const r = await fetch(`${base(sheetId)}/values/${encodeURIComponent(cfg.title + '!A:J')}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  return data.values || [];
}

async function getSheetInternalId(sheetId, token, cfg) {
  const r = await fetch(`${base(sheetId)}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  const sheet = (data.sheets || []).find(s => s.properties.title === cfg.title);
  return sheet ? sheet.properties.sheetId : null;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cfg = KINDS[req.query.kind || 'tasks'];
  if (!cfg) return res.status(400).json({ error: 'kind inválido' });

  try {
    const token   = await getToken();
    const sheetId = process.env.SHEET_ID;
    const auth    = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    if (req.method === 'GET') {
      const rows  = await getRows(sheetId, token, cfg);
      const items = rows.filter(r => r[0] && r[0] !== 'id').map(cfg.fromRow);
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      // Acepta un objeto o { tasks: [...] } (aplicar plantilla = varias tareas de una vez)
      const body  = req.body || {};
      const list  = req.query.kind === 'tasks' && Array.isArray(body.tasks) ? body.tasks : [body];
      if (!list.length || !list.every(cfg.valid)) return res.status(400).json({ error: 'datos incompletos' });
      await ensureSheet(sheetId, token, cfg);
      const created = new Date().toISOString();
      const values  = list.map(o => cfg.toRow(o, newId(), created));
      await fetch(`${base(sheetId)}/values/${encodeURIComponent(cfg.title + '!A:J')}:append?valueInputOption=RAW`, {
        method: 'POST', headers: auth, body: JSON.stringify({ values }),
      });
      return res.status(200).json({ ok: true, count: values.length });
    }

    if (req.method === 'PUT') {
      const o = req.body || {};
      if (!o.id || !cfg.valid(o)) return res.status(400).json({ error: 'datos incompletos' });
      const rows   = await getRows(sheetId, token, cfg);
      const rowIdx = rows.findIndex(r => r[0] === o.id);
      if (rowIdx === -1) return res.status(404).json({ error: 'no encontrado' });
      const created = rows[rowIdx][cfg.createdIdx] || new Date().toISOString();
      const range   = encodeURIComponent(`${cfg.title}!A${rowIdx + 1}:${cfg.lastCol}${rowIdx + 1}`);
      await fetch(`${base(sheetId)}/values/${range}?valueInputOption=RAW`, {
        method: 'PUT', headers: auth, body: JSON.stringify({ values: [cfg.toRow(o, o.id, created)] }),
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id requerido' });
      const rows   = await getRows(sheetId, token, cfg);
      const rowIdx = rows.findIndex(r => r[0] === id);
      if (rowIdx === -1) return res.status(404).json({ error: 'no encontrado' });
      const internal = await getSheetInternalId(sheetId, token, cfg);
      if (internal === null) return res.status(500).json({ error: 'hoja no encontrada' });
      await fetch(`${base(sheetId)}:batchUpdate`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: internal, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 } } }] }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
