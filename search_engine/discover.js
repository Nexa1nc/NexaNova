import fs from "node:fs/promises";

const INDEX_INFO_URL = "https://index.commoncrawl.org/collinfo.json";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDomains(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(line => {
      const [domain, priority] = line.split("|").map(value => value.trim());

      return {
        domain: domain.toLowerCase(),
        priority: Number(priority || 50)
      };
    })
    .filter(item => {
      return (
        item.domain &&
        /\.(it|com|net|org)$/i.test(item.domain)
      );
    });
}

async function getLatestCrawl() {
  const response = await fetch(INDEX_INFO_URL);

  if (!response.ok) {
    throw new Error(
      `Cannot load Common Crawl collections: ${response.status}`
    );
  }

  const collections = await response.json();

  if (!Array.isArray(collections) || !collections.length) {
    throw new Error("Common Crawl collections list is empty");
  }

  return collections[0].id;
}

async function queryDomain(crawlId, domain, limit) {
  const endpoint =
    `https://index.commoncrawl.org/${crawlId}-index`;

  const params = new URLSearchParams({
    url: `${domain}/*`,
    output: "json",
    filter: "status:200",
    filter: "mime:text/html",
    filter: "languages:ita",
    collapse: "urlkey",
    limit: String(limit)
  });

  const response = await fetch(
    `${endpoint}?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(
      `Common Crawl ${domain}: HTTP ${response.status}`
    );
  }

  const text = await response.text();

  if (!text.trim()) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function discover() {
  const domainsFile = await fs.readFile(
    "data/domains.txt",
    "utf8"
  );

  const domains = parseDomains(domainsFile);
  const crawlId = await getLatestCrawl();

  const maxPerDomain = Number(
    process.env.MAX_URLS_PER_DOMAIN || 50
  );

  const seen = new Map();

  console.log(`Common Crawl: ${crawlId}`);
  console.log(`Domains: ${domains.length}`);

  for (const item of domains) {
    console.log(
      `Discovering ${item.domain} (priority ${item.priority})...`
    );

    try {
      const rows = await queryDomain(
        crawlId,
        item.domain,
        maxPerDomain
      );

      for (const row of rows) {
        const url = String(row.url || "");

        if (!/^https?:\/\//i.test(url)) {
          continue;
        }

        const host = new URL(url).hostname.toLowerCase();

        if (
          !host.endsWith(".it") &&
          !host.endsWith(".com") &&
          !host.endsWith(".net") &&
          !host.endsWith(".org")
        ) {
          continue;
        }

        const previous = seen.get(url);

        if (
          !previous ||
          String(row.timestamp || "") >
            String(previous.timestamp || "")
        ) {
          seen.set(url, {
            ...row,
            priority: item.priority
          });
        }
      }
    } catch (error) {
      console.error(
        `Discovery failed for ${item.domain}:`,
        error.message
      );
    }

    await sleep(500);
  }

  return {
    crawlId,
    records: [...seen.values()]
  };
}
