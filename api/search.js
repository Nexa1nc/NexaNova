import { createClient } from '@libsql/client';

export default async function handler(req, res) {
  // Abilita il CORS per il tuo frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query.q;
  if (!query) return res.status(200).json({ results: [] });

  try {
    const db = createClient({
      url: process.env.TURSO_URL_1,
      authToken: process.env.TURSO_TOKEN_1,
    });

    // Cerca usando la wildcard * per la ricerca parziale
    const formattedQuery = `"${query.trim().replace(/"/g, '')}"*`;

    const sql = `
      SELECT p.url, p.title, p.snippet 
      FROM pages_fts fts
      JOIN pages p ON fts.rowid = p.id
      WHERE pages_fts MATCH ?
      ORDER BY rank
      LIMIT 15;
    `;

    const response = await db.execute({ sql, args: [formattedQuery] });

    const results = response.rows.map(row => ({
      title: row.title,
      url: row.url,
      snippet: row.snippet
    }));

    return res.status(200).json({ results });
  } catch (err) {
    console.error('Errore durante la ricerca:', err);
    return res.status(500).json({ error: 'Errore interno del server', details: err.message });
  }
}
