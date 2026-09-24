import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function normalizeQuery(query) {
  return String(query || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

function buildFtsQuery(query) {
  const tokens = query
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];

  const unique = [...new Set(tokens)]
    .filter(token => token.length >= 2)
    .slice(0, 12);

  if (!unique.length) return null;

  return unique
    .map(token => `"${token.replace(/"/g, "")}"*`)
    .join(" AND ");
}

function freshnessScore(lastSeen) {
  if (!lastSeen) return 0;

  const timestamp = Date.parse(lastSeen);
  if (!Number.isFinite(timestamp)) return 0;

  const days = Math.max(
    0,
    (Date.now() - timestamp) / (1000 * 60 * 60 * 24)
  );

  return 100 * Math.exp(-days / 180);
}

function behaviorScore(clicks, impressions) {
  const c = Number(clicks || 0);
  const i = Number(impressions || 0);

  if (i <= 0 || c <= 0) return 0;

  const ctr = c / i;

  // Evita che pochissime impression producano punteggi enormi.
  const confidence = Math.min(1, i / 100);

  return Math.min(100, ctr * 100) * confidence;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    return json(res, 500, {
      error: "Turso environment variables are missing"
    });
  }

  const query = normalizeQuery(req.query?.q);

  if (!query) {
    return json(res, 200, {
      results: [],
      source: "nexanova"
    });
  }

  const ftsQuery = buildFtsQuery(query);

  if (!ftsQuery) {
    return json(res, 200, {
      results: [],
      source: "nexanova"
    });
  }

  try {
    const result = await db.execute({
      sql: `
        SELECT
          p.id,
          p.url,
          p.domain,
          p.title,
          p.snippet,
          p.description,
          p.tags,
          p.base_priority,
          p.quality,
          p.impressions,
          p.clicks,
          p.last_seen,
          bm25(pages_fts) AS bm25_score
        FROM pages_fts
        JOIN pages p
          ON p.id = pages_fts.rowid
        WHERE pages_fts MATCH ?
        LIMIT 100
      `,
      args: [ftsQuery]
    });

    const rows = result.rows || [];

    if (!rows.length) {
      return json(res, 200, {
        results: [],
        source: "nexanova"
      });
    }

    const relevanceValues = rows.map(row =>
      Math.max(0, Number(row.bm25_score) * -1)
    );

    const minRelevance = Math.min(...relevanceValues);
    const maxRelevance = Math.max(...relevanceValues);

    const normalizeRelevance = value => {
      if (maxRelevance === minRelevance) return 100;

      return (
        ((value - minRelevance) /
          (maxRelevance - minRelevance)) *
        100
      );
    };

    const ranked = rows.map((row, index) => {
      const relevance = normalizeRelevance(relevanceValues[index]);
      const priority = Number(row.base_priority || 50);
      const quality = Number(row.quality || 50);
      const freshness = freshnessScore(row.last_seen);
      const behavior = behaviorScore(
        row.clicks,
        row.impressions
      );

      const score =
        relevance * 0.50 +
        priority * 0.20 +
        quality * 0.10 +
        freshness * 0.10 +
        behavior * 0.10;

      return {
        id: Number(row.id),
        url: String(row.url),
        title: String(row.title || row.url),
        description: String(
          row.description ||
          row.snippet ||
          "Nessuna descrizione disponibile."
        ),
        snippet: String(row.snippet || ""),
        domain: String(row.domain || ""),
        tags: String(row.tags || ""),
        score
      };
    });

    ranked.sort((a, b) => b.score - a.score);

    return json(res, 200, {
      results: ranked.slice(0, 50),
      source: "nexanova",
      query
    });
  } catch (error) {
    console.error("NexaNova search error:", error);

    return json(res, 500, {
      error: "Database search failed"
    });
  }
}
