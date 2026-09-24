import { createClient } from "@libsql/client";
import { discover } from "./discover.js";
import { fetchAndExtract } from "./extract.js";
import fs from "node:fs/promises";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function ensureSchema() {
  const statements = [
    `
      CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL,
        title TEXT,
        snippet TEXT,
        description TEXT,
        tags TEXT,
        language TEXT NOT NULL DEFAULT 'ita',
        base_priority REAL NOT NULL DEFAULT 50,
        quality REAL NOT NULL DEFAULT 50,
        impressions INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        last_seen TEXT
      )
    `,

    `
      CREATE INDEX IF NOT EXISTS idx_pages_domain
      ON pages(domain)
    `,

    `
      CREATE INDEX IF NOT EXISTS idx_pages_language
      ON pages(language)
    `,

    `
      CREATE INDEX IF NOT EXISTS idx_pages_priority
      ON pages(base_priority)
    `,

    `
      CREATE TABLE IF NOT EXISTS domain_priorities (
        domain TEXT PRIMARY KEY,
        priority REAL NOT NULL DEFAULT 50
      )
    `,

    `
      CREATE TABLE IF NOT EXISTS daily_stats (
        page_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        impressions INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (page_id, day)
      )
    `,

    `
      CREATE INDEX IF NOT EXISTS idx_daily_stats_page_day
      ON daily_stats(page_id)
    `
  ];

  for (const sql of statements) {
    await db.execute({
      sql,
      args: []
    });
  }

  console.log("Turso schema: ready");
}

function parsePriorityFile(text) {
  const priorities = new Map();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("```")
    ) {
      continue;
    }

    const [domain, rawPriority] = trimmed
      .split("|")
      .map(value => value.trim());

    if (!domain || !rawPriority) {
      continue;
    }

    const priority = Number(rawPriority);

    if (!Number.isFinite(priority)) {
      continue;
    }

    const normalizedDomain = domain
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");

    priorities.set(
      normalizedDomain,
      Math.max(0, Math.min(100, priority))
    );
  }

  return priorities;
}

async function updateDomainPriorities(priorities) {
  for (const [domain, priority] of priorities) {
    await db.execute({
      sql: `
        INSERT INTO domain_priorities (
          domain,
          priority
        )
        VALUES (?, ?)
        ON CONFLICT(domain)
        DO UPDATE SET priority = excluded.priority
      `,
      args: [domain, priority]
    });
  }
}

async function upsertPage(page, basePriority) {
  const result = await db.batch([
    {
      sql: `
        INSERT INTO pages (
          url,
          domain,
          title,
          snippet,
          description,
          tags,
          language,
          base_priority,
          quality,
          last_seen
        )
        VALUES (?, ?, ?, ?, ?, ?, 'ita', ?, ?, ?)

        ON CONFLICT(url)
        DO UPDATE SET
          domain = excluded.domain,
          title = excluded.title,
          snippet = excluded.snippet,
          description = excluded.description,
          tags = excluded.tags,
          language = excluded.language,
          base_priority = excluded.base_priority,
          quality = excluded.quality,
          last_seen = excluded.last_seen
      `,
      args: [
        page.url,
        page.domain,
        page.title,
        page.snippet,
        page.description,
        page.tags,
        basePriority,
        page.quality,
        page.lastSeen
      ]
    },

    {
      sql: `
        SELECT id
        FROM pages
        WHERE url = ?
        LIMIT 1
      `,
      args: [page.url]
    }
  ]);

  return Number(
    result[1]?.rows?.[0]?.id
  );
}

async function main() {
  if (
    !process.env.TURSO_DATABASE_URL ||
    !process.env.TURSO_AUTH_TOKEN
  ) {
    throw new Error(
      "Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"
    );
  }

  console.log("Connecting to Turso...");

  await ensureSchema();

  await fs.access(
    "data/domains.txt"
  );

  const prioritiesText =
    await fs.readFile(
      "data/domains.txt",
      "utf8"
    );

  const priorities =
    parsePriorityFile(
      prioritiesText
    );

  console.log(
    `Loaded ${priorities.size} domain priorities`
  );

  if (priorities.size === 0) {
    throw new Error(
      "No valid domains found in data/domains.txt"
    );
  }

  await updateDomainPriorities(
    priorities
  );

  const discovered =
    await discover();

  console.log(
    `Discovered ${discovered.records.length} URLs`
  );

  let indexed = 0;
  let failed = 0;

  const maxPages = Number(
    process.env.MAX_PAGES_PER_RUN || 500
  );

  const records =
    discovered.records.slice(
      0,
      maxPages
    );

  for (
    const [index, record]
    of records.entries()
  ) {
    try {
      console.log(
        `[${index + 1}/${records.length}] ${record.url}`
      );

      const extracted =
        await fetchAndExtract(
          record
        );

      const domain =
        new URL(
          extracted.url
        ).hostname
          .toLowerCase()
          .replace(
            /^www\./,
            ""
          );

      const basePriority =
        priorities.get(domain) ??
        Number(
          record.priority || 50
        );

      const timestamp =
        String(
          record.timestamp || ""
        );

      const parsedTimestamp =
        timestamp.replace(
          /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}).*$/,
          "$1-$2-$3T$4:$5:$6Z"
        );

      const date =
        new Date(
          parsedTimestamp
        );

      const lastSeen =
        Number.isNaN(
          date.getTime()
        )
          ? new Date().toISOString()
          : date.toISOString();

      await upsertPage(
        {
          ...extracted,
          domain,
          lastSeen
        },
        basePriority
      );

      indexed++;

    } catch (error) {
      failed++;

      console.error(
        `Failed ${record.url}:`,
        error.message
      );
    }
  }

  console.log("");
  console.log(
    "========== NexaNova Index =========="
  );

  console.log(
    `Crawl:    ${discovered.crawlId}`
  );

  console.log(
    `Found:    ${records.length}`
  );

  console.log(
    `Indexed:  ${indexed}`
  );

  console.log(
    `Failed:   ${failed}`
  );

  console.log(
    "===================================="
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
