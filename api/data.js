export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1. Refresh access token
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

    // 2. Fetch sheet data
    const sheetId   = process.env.SHEET_ID;
    const sheetName = req.query.sheet || process.env.SHEET_NAME || 'Sheet1';
    // 'google' sheets: Day, Status, Cost, Impressions, Clicks, Conversions, ...
    // 'meta'   sheets: Day, Amount Spent, Impressions, Link Clicks, Results, Campaign Name
    const channel   = (req.query.channel || 'google').toLowerCase();
    const range     = encodeURIComponent(`${sheetName}!A1:M2000`);
    const sheetRes  = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const sheetData = await sheetRes.json();
    if (sheetData.error) {
      return res.status(500).json({ error: sheetData.error.message });
    }

    // 3. Parse rows (skip header) — column layout depends on the ad platform
    const parseRow = channel === 'meta'
      ? row => ({
          date:  row[0] || '',
          cost:  parseFloat(row[1]) || 0,
          imp:   parseInt(row[2])   || 0,
          clics: parseInt(row[3])   || 0,
          conv:  parseFloat(row[4]) || 0,
        })
      : row => ({
          date:  row[0] || '',
          cost:  parseFloat(row[2]) || 0,
          imp:   parseInt(row[3])   || 0,
          clics: parseInt(row[4])   || 0,
          conv:  parseFloat(row[5]) || 0,
        });

    const rows = (sheetData.values || []).slice(1)
      .map(parseRow)
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ rows });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
