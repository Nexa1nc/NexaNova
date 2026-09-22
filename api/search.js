import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_URL_1,
  authToken: process.env.TURSO_TOKEN_1,
});

export default async function handler(req, res) {
  // Gestione CORS per chiamate dall'interfaccia
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { q } = req.query;

  if (!q || q.trim() === '') {
    return res.status(400).json({ results: [] });
  }

  try {
    // Cerca direttamente nell'indice FTS5 di Turso
    const result = await db.execute({
      sql: `
        SELECT pages.title, pages.url, pages.snippet
        FROM pages_fts
        JOIN pages ON pages.id = pages_fts.rowid
        WHERE pages_fts MATCH ?
        LIMIT 50
      `,
      args: [`"${q.replace(/"/g, '""')}"*`],
    });

    const results = result.rows.map((row) => ({
      title: row.title,
      url: row.url,
      description: row.snippet,
    }));

    return res.status(200).json({ results });
  } catch (error) {
    console.error('Errore durante la ricerca:', error);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
}
