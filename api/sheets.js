export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type:    'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(500).json({ error: 'Failed to get access token', detail: tokenData });
    }

    const sheetId = process.env.SHEET_ID;
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const meta = await metaRes.json();
    if (meta.error) return res.status(500).json({ error: meta.error.message });

    const titles = (meta.sheets || []).map(s => s.properties.title);
    return res.status(200).json({ sheets: titles });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
