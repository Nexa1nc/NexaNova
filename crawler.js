import dotenv from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@libsql/client';

dotenv.config();

const db = createClient({
  url: process.env.TURSO_URL_1,
  authToken: process.env.TURSO_TOKEN_1,
});

const queue = [
  'https://it.wikipedia.org/wiki/Informatica',
  'https://it.wikipedia.org/wiki/Programmazione_informatica',
  'https://news.ycombinator.com/'
];
const visited = new Set();

async function crawl() {
  if (queue.length === 0) {
    console.log('[FINITO] Coda completata.');
    process.exit(0);
  }

  const url = queue.shift();
  if (visited.has(url)) return crawl();
  visited.add(url);

  console.log(`[CRAWLING] Visito: ${url}`);

  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'NexaNovaEngineBot/1.0' },
      timeout: 6000,
    });

    const $ = cheerio.load(data);
    const title = $('title').text().trim() || url;
    
    $('script, style, noscript').remove();
    const fullText = $('body').text().replace(/\s+/g, ' ').trim();
    const snippet = fullText.substring(0, 250) + '...';

    // Salva URL, Titolo e Snippet direttamente su Turso DB
    await db.execute({
      sql: `INSERT OR IGNORE INTO pages (url, title, snippet) VALUES (?, ?, ?)`,
      args: [url, title, snippet]
    });

    console.log(`[SALVATO] -> ${title}`);

    // Estrai nuovi link per la coda
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http') && !visited.has(href)) {
        queue.push(href);
      }
    });

  } catch (err) {
    console.error(`[ERRORE] ${url}:`, err.message);
  }

  setTimeout(crawl, 1000);
}

crawl();
