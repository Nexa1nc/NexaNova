require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@libsql/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Inizializzazione Database e Cloudflare R2
const db = createClient({
  url: process.env.TURSO_URL_1,
  authToken: process.env.TURSO_TOKEN_1,
});

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const queue = ['https://it.wikipedia.org/wiki/Informatica', 'https://news.ycombinator.com/'];
const visited = new Set();

async function crawl() {
  if (queue.length === 0) return;
  const url = queue.shift();

  if (visited.has(url)) return crawl();
  visited.add(url);

  console.log(`[CRAWLING] ${url}`);

  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'NexaNovaEngineBot/1.0' },
      timeout: 5000,
    });

    const $ = cheerio.load(data);
    const title = $('title').text().trim() || url;
    
    // Pulizia testo: rimuove script e stile
    $('script, style, noscript').remove();
    const fullText = $('body').text().replace(/\s+/g, ' ').trim();
    const snippet = fullText.substring(0, 200) + '...';

    // 1. Salva il testo completo su Cloudflare R2
    const r2Key = `pages/${Date.now()}_${Math.random().toString(36).substring(7)}.txt`;
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
      Body: fullText,
      ContentType: 'text/plain; charset=utf-8'
    }));

    // 2. Salva l'indice di ricerca su Turso DB (FTS5)
    await db.execute({
      sql: `INSERT OR IGNORE INTO pages (url, title, snippet, r2_key) VALUES (?, ?, ?, ?)`,
      args: [url, title, snippet, r2Key]
    });

    console.log(`[SALVATO] ${title}`);

    // 3. Estrai nuovi link per la coda
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http') && !visited.has(href)) {
        queue.push(href);
      }
    });

  } catch (err) {
    console.error(`[ERRORE] ${url}:`, err.message);
  }

  setTimeout(crawl, 1500); // Pausa di 1.5s per rispetto dei server
}

crawl();
