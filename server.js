const express = require('express');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

function normalizeResults(sourceName, items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => item && (item.url || item.FirstURL || item.link || item.title))
    .slice(0, 10)
    .map((item) => ({
      title: item.title || item.name || item.Text || 'Risultato',
      url: item.url || item.FirstURL || item.link || '#',
      description: item.description || item.snippet || item.content || item.Text || '',
      source: sourceName,
    }));
}

async function fetchDuckDuckGo(query) {
  const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
  const data = await response.json();

  const items = [];
  if (Array.isArray(data.Results)) items.push(...data.Results);
  if (Array.isArray(data.RelatedTopics)) items.push(...data.RelatedTopics);

  return normalizeResults('DuckDuckGo', items.map((item) => ({
    title: item.Text || item.Result || item.Text,
    url: item.FirstURL || item.url,
    description: item.Text || item.Result || '',
  })));
}

async function fetchWikipedia(query) {
  const response = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`);
  const data = await response.json();
  const items = data?.query?.search || [];

  return normalizeResults('Wikipedia', items.map((item) => ({
    title: item.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title).replace(/%20/g, '_')}`,
    description: item.snippet ? item.snippet.replace(/<[^>]*>/g, '') : '',
  })));
}

async function fetchBrave(query) {
  if (!process.env.BRAVE_SEARCH_API_KEY) return [];

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY,
    },
  });

  if (!response.ok) return [];
  const data = await response.json();
  return normalizeResults('Brave Search', data.web?.results || []);
}

async function fetchTavily(query) {
  if (!process.env.TAVILY_API_KEY) return [];

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 10,
    }),
  });

  if (!response.ok) return [];
  const data = await response.json();
  return normalizeResults('Tavily', data.results || []);
}

async function fetchSearx(query) {
  const baseUrl = process.env.SEARX_URL || 'https://searx.be';
  const response = await fetch(`${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`);
  const data = await response.json();
  return normalizeResults('Searx', data.results || []);
}

async function fetchBing(query) {
  if (!process.env.BING_SEARCH_API_KEY) return [];

  const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=10`, {
    headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_SEARCH_API_KEY },
  });

  if (!response.ok) return [];
  const data = await response.json();
  return normalizeResults('Bing', data.webPages?.value || []);
}

async function fetchGoogle(query) {
  if (!process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || !process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID) return [];

  const response = await fetch(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${process.env.GOOGLE_CUSTOM_SEARCH_API_KEY}&cx=${process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID}&num=10`);
  const data = await response.json();
  return normalizeResults('Google Custom Search', data.items || []);
}

async function fetchSerper(query) {
  if (!process.env.SERPER_API_KEY) return [];

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query }),
  });

  if (!response.ok) return [];
  const data = await response.json();
  return normalizeResults('Serper', data.organic || []);
}

const providerChain = [
  { name: 'duckduckgo', fn: fetchDuckDuckGo },
  { name: 'wikipedia', fn: fetchWikipedia },
  { name: 'brave', fn: fetchBrave },
  { name: 'tavily', fn: fetchTavily },
  { name: 'searx', fn: fetchSearx },
  { name: 'bing', fn: fetchBing },
  { name: 'google', fn: fetchGoogle },
  { name: 'serper', fn: fetchSerper },
];

app.use(express.static(path.join(__dirname)));

app.get('/api/search-config', (req, res) => {
  res.json({
    braveKey: process.env.BRAVE_SEARCH_API_KEY || '',
    tavilyKey: process.env.TAVILY_API_KEY || '',
    bingKey: process.env.BING_SEARCH_API_KEY || '',
    googleKey: process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || '',
    googleEngineId: process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || '',
    serperKey: process.env.SERPER_API_KEY || '',
    searxUrl: process.env.SEARX_URL || 'https://searx.be',
  });
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || '').trim();

  if (!query) {
    return res.json({ results: [], engine: 'none' });
  }

  for (const provider of providerChain) {
    try {
      const results = await provider.fn(query);
      if (Array.isArray(results) && results.length > 0) {
        return res.json({
          results,
          engine: provider.name,
          query,
        });
      }
    } catch (error) {
      console.warn(`Provider failed: ${provider.name}`, error.message);
    }
  }

  return res.json({ results: [], engine: 'none', query });
});

app.listen(PORT, () => {
  console.log(`NexaNova search backend is running on http://localhost:${PORT}`);
});
