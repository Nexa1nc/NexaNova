export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query = "", page = 1, limit = 10 } = req.body || {};
  const offset = (page - 1) * limit;

  const QDRANT_URL = process.env.QDRANT_URL;
  const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

  try {
    const q = query.trim().toLowerCase();

    // 1. Scarichiamo i punti presenti nel database
    const response = await fetch(`${QDRANT_URL}/collections/global_web/points/scroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": QDRANT_API_KEY
      },
      body: JSON.stringify({
        limit: 300,
        with_payload: true
      })
    });

    const data = await response.json();

    if (!data.result || !data.result.points) {
      return res.status(200).json({ result: { points: [] } });
    }

    const allPoints = data.result.points;

    // Se non c'è query, mostriamo i primi risultati
    if (!q) {
      return res.status(200).json({
        result: {
          points: allPoints.slice(offset, offset + limit),
          total: allPoints.length
        }
      });
    }

    const terms = q.split(/\s+/).filter(Boolean);

    // 2. Calcoliamo il punteggio di pertinenza per ciascun risultato
    const scoredPoints = allPoints.map(pt => {
      const payload = pt.payload || {};
      const title = (payload.title || "").toLowerCase();
      const domain = (payload.domain || "").toLowerCase();
      const desc = (payload.description || "").toLowerCase();
      const url = (payload.url || "").toLowerCase();

      let score = 0;

      terms.forEach(term => {
        // Se c'è corrispondenza nell'URL o nel dominio, punteggio alto
        if (domain.includes(term)) score += 100;
        else if (url.includes(term)) score += 80;

        // Se c'è corrispondenza nel titolo
        if (title.includes(term)) score += 50;

        // Se c'è corrispondenza nella descrizione
        if (desc.includes(term)) score += 20;
      });

      return { point: pt, score };
    });

    // 3. Filtriamo solo chi ha un punteggio > 0 e ordiniamo dal più rilevante al meno rilevante
    let filteredResults = scoredPoints
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.point);

    // 4. Paginazione dei risultati trovati
    const paginatedPoints = filteredResults.slice(offset, offset + limit);

    return res.status(200).json({
      result: {
        points: paginatedPoints,
        total: filteredResults.length
      }
    });

  } catch (error) {
    return res.status(500).json({ error: 'Errore durante la ricerca' });
  }
}
