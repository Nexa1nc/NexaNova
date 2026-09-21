// api/search.js
export default async function handler(req, res) {
  const query = req.query.q || req.body?.query;
  if (!query) return res.status(400).json({ error: "Query mancante" });

  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const html = await response.text();
    
    // Parsing semplice delle righe dei risultati
    const results = [];
    const regex = /<a class="result__url" href="([^"]+)".*?>\s*(.*?)\s*<\/a>[\s\S]*?<a class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let match;

    while ((match = regex.exec(html)) !== null && results.length < 15) {
      let rawUrl = match[1];
      if (rawUrl.includes('uddg=')) {
        rawUrl = decodeURIComponent(rawUrl.split('uddg=')[1].split('&')[0]);
      }
      results.push({
        url: rawUrl,
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        content: match[3].replace(/<[^>]+>/g, '').trim()
      });
    }

    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: "Errore durante la ricerca" });
  }
}
