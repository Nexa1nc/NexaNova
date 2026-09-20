export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query = "", page = 1, limit = 10 } = req.body || {};
  const offset = (page - 1) * limit;

  const QDRANT_URL = process.env.QDRANT_URL;
  const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

  try {
    const bodyPayload = query.trim() !== "" ? {
      filter: {
        should: [
          { key: "title", match: { text: query } },
          { key: "description", match: { text: query } },
          { key: "domain", match: { text: query } }
        ]
      },
      limit: limit,
      offset: offset,
      with_payload: true
    } : {
      limit: limit,
      offset: offset,
      with_payload: true
    };

    const response = await fetch(`${QDRANT_URL}/collections/global_web/points/scroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": QDRANT_API_KEY
      },
      body: JSON.stringify(bodyPayload)
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Errore nel recupero dei dati' });
  }
}
