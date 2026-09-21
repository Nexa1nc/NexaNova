export default async function handler(req, res) {
  // Impostazione CORS per consentire chiamate dal frontend
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Parametro di ricerca "q" mancante.' });
  }

  try {
    // Richiesta a DuckDuckGo Lite HTML
    const response = await fetch(`https://lite.duckduckgo.com/lite/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: `q=${encodeURIComponent(q)}`
    });

    const html = await response.text();

    // Regex per estrarre i link, titoli e frammenti di testo da DuckDuckGo Lite
    const results = [];
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>(.*?)<\/a>/gi;
    const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>(.*?)<\/td>/gi;

    let matchLink;
    const links = [];
    while ((matchLink = linkRegex.exec(html)) !== null) {
      links.push({
        url: matchLink[1],
        title: matchLink[2].replace(/<[^>]+>/g, '').trim()
      });
    }

    let matchSnippet;
    const snippets = [];
    while ((matchSnippet = snippetRegex.exec(html)) !== null) {
      snippets.push(matchSnippet[1].replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < links.length; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        content: snippets[i] || 'Nessuna descrizione disponibile.'
      });
    }

    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: 'Errore durante la ricerca su DuckDuckGo.' });
  }
}
