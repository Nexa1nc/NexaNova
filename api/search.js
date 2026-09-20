export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query = "", page = 1, limit = 10 } = req.body || {};
  const offset = (page - 1) * limit;

  const QDRANT_URL = process.env.QDRANT_URL;
  const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

  try {
    const q = query.trim().toLowerCase();

    // 1. Scarichiamo i punti dal database Qdrant
    const response = await fetch(`${QDRANT_URL}/collections/global_web/points/scroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": QDRANT_API_KEY
      },
      body: JSON.stringify({
        limit: 500, // Aumentiamo il limite per analizzare un corpus più ampio
        with_payload: true
      })
    });

    const data = await response.json();

    if (!data.result || !data.result.points) {
      return res.status(200).json({ result: { points: [] } });
    }

    const allPoints = data.result.points;

    // Se la query è vuota, restituiamo direttamente i primi risultati
    if (!q) {
      const paginatedPoints = allPoints.slice(offset, offset + limit);
      return res.status(200).json({
        result: {
          points: paginatedPoints,
          total: allPoints.length
        }
      });
    }

    // 2. Separiamo le parole della ricerca (es. "ciao mondo" -> ["ciao", "mondo"])
    const terms = q.split(/\s+/).filter(Boolean);

    // 3. Calcoliamo un punteggio di pertinenza per ogni pagina
    const scoredPoints = allPoints.map(pt => {
      const payload = pt.payload || {};
      const title = (payload.title || "").toLowerCase();
      const domain = (payload.domain || "").toLowerCase();
      const desc = (payload.description || "").toLowerCase();
      const url = (payload.url || "").toLowerCase();

      let score = 0;

      terms.forEach(term => {
        // Corrispondenza nell'URL o dominio (peso altissimo)
        if (domain.includes(term)) score += 10;
        if (url.includes(term)) score += 8;

        // Corrispondenza nel Titolo (peso alto)
        if (title.includes(term)) score += 5;

        // Corrispondenza nella Descrizione/Testo (peso medio)
        if (desc.includes(term)) score += 2;
      });

      return { point: pt, score };
    });

    // 4. Ordiniamo i risultati dal più pertinente al meno pertinente
    let filteredResults = scoredPoints
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.point);

    // 5. SE NON TROVA NESSUN RISULTATO ESATTO (es. con la parola "ciao"):
    // Invece di mostrare "Nessun risultato", restituisce le pagine del database come fa un motore di ricerca
    if (filteredResults.length === 0) {
      filteredResults = allPoints;
    }

    // Paginazione dei risultati finali
    const paginatedPoints = filteredResults.slice(offset, offset + limit);

    return res.status(200).json({
      result: {
        points: paginatedPoints,
        total: filteredResults.length
      }
    });

  } catch (error) {
    return res.status(500).json({ error: 'Errore nel recupero dei dati' });
  }
}
