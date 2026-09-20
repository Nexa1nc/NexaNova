export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query = "", page = 1, limit = 10 } = req.body || {};
  const offset = (page - 1) * limit;

  const QDRANT_URL = process.env.QDRANT_URL;
  const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
  const HF_TOKEN = process.env.HF_TOKEN;

  try {
    const q = query.trim();

    // 1. Se la query è vuota, restituiamo i primi punti generici
    if (!q) {
      const response = await fetch(`${QDRANT_URL}/collections/global_web/points/scroll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": QDRANT_API_KEY
        },
        body: JSON.stringify({ limit, offset, with_payload: true })
      });
      const data = await response.json();
      return res.status(200).json(data);
    }

    // 2. Convertiamo la parola cercata in un vettore numerico tramite Hugging Face
    const hfRes = await fetch(
      "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
      {
        headers: {
          "Content-Type": "application/json",
          ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {})
        },
        method: "POST",
        body: JSON.stringify({ inputs: q, options: { wait_for_model: true } }),
      }
    );

    const vector = await hfRes.json();

    // 3. Se il vettore è stato generato correttamente, eseguiamo la ricerca vettoriale su Qdrant
    if (Array.isArray(vector) && typeof vector[0] === "number") {
      const qdrantRes = await fetch(`${QDRANT_URL}/collections/global_web/points/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": QDRANT_API_KEY
        },
        body: JSON.stringify({
          vector: vector,
          limit: limit,
          offset: offset,
          with_payload: true
        })
      });

      const qdrantData = await qdrantRes.json();
      return res.status(200).json(qdrantData);
    }

    // 4. Fallback in caso di errori temporanei dell'API
    const scrollRes = await fetch(`${QDRANT_URL}/collections/global_web/points/scroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": QDRANT_API_KEY
      },
      body: JSON.stringify({ limit: limit, offset: offset, with_payload: true })
    });
    const scrollData = await scrollRes.json();

    return res.status(200).json(scrollData);

  } catch (error) {
    return res.status(500).json({ error: 'Errore durante la ricerca' });
  }
}
