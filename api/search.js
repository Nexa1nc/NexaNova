const https = require('https');
const http = require('http');

// API KEYS - aggiungerai questi come secrets su Vercel
const SERPER_KEY = process.env.SERPER_API_KEY;
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

async function searchDuckDuckGo(query) {
  return new Promise((resolve) => {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const results = (json.Results || []).map(r => ({
              url: r.FirstURL,
              title: r.Text,
              description: r.Result || '',
              verified: false
            })).filter(r => r.url);
            resolve(results.slice(0, 10));
          } catch {
            resolve([]);
          }
        });
      }).on('error', () => resolve([]));
    } catch {
      resolve([]);
    }
  });
}

async function searchSerper(query) {
  return new Promise((resolve) => {
    if (!SERPER_KEY) {
      resolve([]);
      return;
    }
    
    const data = JSON.stringify({ q: query });
    const options = {
      hostname: 'google.serper.dev',
      path: '/search',
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_KEY,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const results = (json.organic || []).map(r => ({
            url: r.link,
            title: r.title,
            description: r.snippet || '',
            verified: false
          }));
          resolve(results.slice(0, 10));
        } catch {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.write(data);
    req.end();
  });
}

async function searchGoogle(query) {
  return new Promise((resolve) => {
    if (!GOOGLE_KEY || !GOOGLE_CX) {
      resolve([]);
      return;
    }

    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${GOOGLE_KEY}&cx=${GOOGLE_CX}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = (json.items || []).map(r => ({
            url: r.link,
            title: r.title,
            description: r.snippet || '',
            verified: false
          }));
          resolve(results);
        } catch {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ results: [] });
  }

  console.log(`Searching for: ${query}`);

  // Prova in ordine con fallback
  let results = await searchDuckDuckGo(query);
  if (results.length > 0) {
    console.log('✓ DuckDuckGo success');
    return res.json({ results });
  }

  results = await searchSerper(query);
  if (results.length > 0) {
    console.log('✓ Serper success');
    return res.json({ results });
  }

  results = await searchGoogle(query);
  if (results.length > 0) {
    console.log('✓ Google success');
    return res.json({ results });
  }

  console.log('✗ All APIs failed');
  res.json({ results: [] });
};
