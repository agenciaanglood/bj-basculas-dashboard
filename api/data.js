module.exports = async function handler(req, res) {
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
      }).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(500).json({ error: 'Token failed', detail: tokenData });
    }

    const sheetId   = process.env.SHEET_ID;
    const sheetName = process.env.SHEET_NAME || 'Sheet1';
    const range     = encodeURIComponent(sheetName + '!A1:H2000');
    const sheetRes  = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId + '/values/' + range,
      { headers: { Authorization: 'Bearer ' + tokenData.access_token } }
    );
    const sheetData = await sheetRes.json();
    if (sheetData.error) {
      return res.status(500).json({ error: sheetData.error.message });
    }

    const rows = (sheetData.values || []).slice(1).map(function(row) {
      return {
        date: row[0] || '',
        cost: parseFloat(row[2]) || 0,
        imp:  parseInt(row[3])   || 0,
        clics: parseInt(row[4]) || 0,
        conv: parseFloat(row[5]) || 0,
      };
    }).filter(function(r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.date); });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ rows: rows });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};