export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query = "", page = 1, limit = 10 } = req.body || {};
  const offset = (page - 1) * limit;

  const QDRANT_URL = process.env.QDRANT_URL;
  const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

  try {
    const q = query.trim().toLowerCase();

    // 1. Se la query è vuota, mostriamo i primi risultati generali
    if (!q) {
      const response = await fetch(`${QDRANT_URL}/collections/global_web/points/scroll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": QDRANT_API_KEY
        },
        body: JSON.stringify({
          limit: limit,
          offset: offset,
          with_payload: true
        })
      });

      const data = await response.json();
      return res.status(200).json(data);
    }

    // 2. Se l'utente digita una parola, recuperiamo tutti i dati e li filtriamo in modo tollerante (case-insensitive)
    const response = await fetch(`${QDRANT_URL}/collections/global_web/points/scroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": QDRANT_API_KEY
      },
      body: JSON.stringify({
        limit: 200,
        with_payload: true
      })
    });

    const data = await response.json();

    if (data.result && data.result.points) {
      // Filtriamo i risultati in JS cercando nel titolo, nel dominio o nella descrizione
      const filtered = data.result.points.filter(pt => {
        const payload = pt.payload || {};
        const title = (payload.title || "").toLowerCase();
        const domain = (payload.domain || "").toLowerCase();
        const desc = (payload.description || "").toLowerCase();
        const url = (payload.url || "").toLowerCase();

        return title.includes(q) || domain.includes(q) || desc.includes(q) || url.includes(q);
      });

      // Paginazione manuale sui risultati filtrati
      const paginatedPoints = filtered.slice(offset, offset + limit);

      return res.status(200).json({
        result: {
          points: paginatedPoints,
          total: filtered.length
        }
      });
    }

    return res.status(200).json({ result: { points: [] } });

  } catch (error) {
    return res.status(500).json({ error: 'Errore nel recupero dei dati' });
  }
}
