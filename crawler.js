import { createClient } from '@libsql/client';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';

// Connessione al DB Turso tramite variabili d'ambiente
const db = createClient({
  url: process.env.TURSO_URL_1,
  authToken: process.env.TURSO_TOKEN_1,
});

// Estensioni e pattern spazzatura da IGNORARE
const BAD_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|zip|tar|gz|mp3|mp4|avi|exe|dmg|css|js|json|xml)$/i;
const BAD_URL_PATTERNS = [/login/i, /signup/i, /cart/i, /checkout/i, /admin/i, /wp-admin/i, /account/i];

// 1. Filtro Anti-Spazzatura sugli URL
function isCleanUrl(urlString) {
  try {
    const parsed = new URL(urlString);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (BAD_EXTENSIONS.test(parsed.pathname)) return false;
    if (urlString.length > 250 || parsed.search.length > 80) return false;

    for (let pattern of BAD_URL_PATTERNS) {
      if (pattern.test(parsed.pathname)) return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

// 2. Calcolo del Punteggio di Priorità
function calculatePriority(urlString) {
  let priority = 1;
  try {
    const parsed = new URL(urlString);
    const domain = parsed.hostname.toLowerCase();

    if (domain.includes('wikipedia.org')) return 100;
    if (domain.endsWith('.gov') || domain.endsWith('.edu') || domain.endsWith('.edu.it')) return 50;

    const HIGH_AUTH = ['ansa.it', 'treccani.it', 'repubblica.it', 'corriere.it', 'github.com', 'stackoverflow.com'];
    if (HIGH_AUTH.some(d => domain.includes(d))) {
      priority += 30;
    }

    const depth = parsed.pathname.split('/').filter(Boolean).length;
    if (depth === 0) priority += 20;
    else if (depth === 1) priority += 10;

  } catch (e) {}

  return priority;
}

// 3. Gestore dedicato per Wikipedia tramite API REST Ufficiale
async function crawlWikipediaApi(searchTerm) {
  console.log(`[WIKI API] Elaborazione: ${searchTerm}`);
  const apiUrl = `https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchTerm)}`;

  try {
    const res = await axios.get(apiUrl, {
      headers: { 'User-Agent': 'NexaNovaBot/1.0 (https://nexanova.it)' },
      timeout: 5000
    });

    const data = res.data;
    if (data.type === 'standard' && data.extract) {
      const pageUrl = data.content_urls.desktop.page;
      const title = data.title;
      const snippet = data.extract;

      const insert = await db.execute({
        sql: `INSERT OR IGNORE INTO pages (url, title, snippet) VALUES (?, ?, ?) RETURNING id`,
        args: [pageUrl, title, snippet]
      });

      if (insert.rows.length > 0) {
        const pageId = insert.rows[0].id;
        await db.execute({
          sql: `INSERT OR REPLACE INTO pages_fts (rowid, title, snippet) VALUES (?, ?, ?)`,
          args: [pageId, title, snippet]
        });
        console.log(`[WIKI OK] Indicizzato: ${title}`);
      }
    }
  } catch (err) {
    console.error(`[WIKI ERR] Errore su ${searchTerm}:`, err.message);
  }
}

// 4. Scraping Standard per siti Web con Cheerio
async function scrapeStandardWebpage(pageUrl) {
  const response = await axios.get(pageUrl, {
    timeout: 6000,
    headers: { 'User-Agent': 'NexaNovaBot/1.0 (+https://nexanova.it)' }
  });

  const html = response.data;
  const $ = cheerio.load(html);

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  if (bodyText.length < 300) {
    console.log(`[SKIP] Pagina priva di testo sufficiente: ${pageUrl}`);
    return;
  }

  const title = $('title').text().trim() || pageUrl;
  const snippet = $('meta[name="description"]').attr('content') || bodyText.substring(0, 200) + '...';

  const insert = await db.execute({
    sql: `INSERT OR IGNORE INTO pages (url, title, snippet) VALUES (?, ?, ?) RETURNING id`,
    args: [pageUrl, title, snippet]
  });

  if (insert.rows.length > 0) {
    const pageId = insert.rows[0].id;
    await db.execute({
      sql: `INSERT OR REPLACE INTO pages_fts (rowid, title, snippet) VALUES (?, ?, ?)`,
      args: [pageId, title, snippet]
    });
    console.log(`[WEB OK] Indicizzato: ${title}`);
  }

  const links = [];
  $('a[href]').each((_, el) => {
    let href = $(el).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, pageUrl).href.split('#')[0];
      if (isCleanUrl(absoluteUrl)) {
        links.push({
          url: absoluteUrl,
          priority: calculatePriority(absoluteUrl)
        });
      }
    } catch (e) {}
  });

  for (let link of links) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO crawl_queue (url, priority) VALUES (?, ?)`,
      args: [link.url, link.priority]
    });
  }
}


// 5. Inizializzazione Tabelle DB tramite batch esplicito
async function initDb() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      title TEXT,
      snippet TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      title,
      snippet
    )`,
    `CREATE TABLE IF NOT EXISTS crawl_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      priority INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  ], "write");
}
// 6. Esecuzione Principale
async function main() {
  console.log("Inizializzazione Database...");
  await initDb();

  const queueResult = await db.execute({
    sql: `SELECT id, url FROM crawl_queue 
          WHERE status = 'pending' 
          ORDER BY priority DESC, created_at ASC 
          LIMIT 15`,
    args: []
  });

  let items = queueResult.rows;

  if (items.length === 0) {
    console.log("Coda vuota! Inserimento dei Seed URL iniziali...");
    const seeds = [
      'https://it.wikipedia.org/wiki/Informatica',
      'https://www.ansa.it',
      'https://www.treccani.it'
    ];
    for (let seed of seeds) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO crawl_queue (url, priority) VALUES (?, ?)`,
        args: [seed, calculatePriority(seed)]
      });
    }
    return;
  }

  for (let item of items) {
    await db.execute({
      sql: `UPDATE crawl_queue SET status = 'processing' WHERE id = ?`,
      args: [item.id]
    });

    try {
      if (item.url.includes('wikipedia.org/wiki/')) {
        const articleName = item.url.split('/wiki/')[1];
        await crawlWikipediaApi(decodeURIComponent(articleName));
      } else {
        await scrapeStandardWebpage(item.url);
      }

      await db.execute({
        sql: `UPDATE crawl_queue SET status = 'completed' WHERE id = ?`,
        args: [item.id]
      });
    } catch (err) {
      console.error(`[FAIL] Errore nell'elaborazione di ${item.url}:`, err.message);
      await db.execute({
        sql: `UPDATE crawl_queue SET status = 'failed' WHERE id = ?`,
        args: [item.id]
      });
    }
  }

  console.log("Batch di crawling completato con successo!");
}

main().catch((err) => {
  console.error("Errore critico durante l'esecuzione:", err);
  process.exit(1);
});
