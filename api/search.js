import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const WIKIPEDIA_API =
  "https://it.wikipedia.org/w/api.php";

function json(res, status, body) {
  res
    .status(status)
    .setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    );

  res.end(
    JSON.stringify(body)
  );
}

function normalizeQuery(query) {
  return String(query || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

function tokenize(query) {
  const tokens =
    query
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [];

  return [
    ...new Set(
      tokens.filter(
        token => token.length >= 2
      )
    )
  ].slice(0, 12);
}

function calculateFreshness(lastSeen) {
  if (!lastSeen) {
    return 0;
  }

  const time =
    Date.parse(lastSeen);

  if (!Number.isFinite(time)) {
    return 0;
  }

  const days =
    Math.max(
      0,
      (
        Date.now() - time
      ) /
        (
          1000 *
          60 *
          60 *
          24
        )
    );

  return (
    100 *
    Math.exp(
      -days / 180
    )
  );
}

function calculateBehavior(
  clicks,
  impressions
) {
  const c =
    Number(clicks || 0);

  const i =
    Number(impressions || 0);

  if (
    i <= 0 ||
    c <= 0
  ) {
    return 0;
  }

  const ctr =
    c / i;

  const confidence =
    Math.min(
      1,
      i / 100
    );

  return Math.min(
    100,
    ctr * 100
  ) * confidence;
}

function fieldMatchScore(
  field,
  tokens,
  multiplier
) {
  const value =
    String(field || "")
      .toLowerCase();

  let score = 0;

  for (const token of tokens) {
    if (
      value.includes(token)
    ) {
      score += multiplier;
    }
  }

  return Math.min(
    100,
    score
  );
}

function calculateRelevance(
  row,
  query,
  tokens
) {
  let score = 0;

  score += fieldMatchScore(
    row.title,
    tokens,
    14
  );

  score += fieldMatchScore(
    row.tags,
    tokens,
    9
  );

  score += fieldMatchScore(
    row.snippet,
    tokens,
    6
  );

  score += fieldMatchScore(
    row.description,
    tokens,
    4
  );

  const title =
    String(
      row.title || ""
    ).toLowerCase();

  const normalizedQuery =
    query.toLowerCase();

  if (
    title.includes(
      normalizedQuery
    )
  ) {
    score += 30;
  }

  return Math.min(
    100,
    score
  );
}

async function searchDatabase(
  query
) {
  const tokens =
    tokenize(query);

  if (!tokens.length) {
    return [];
  }

  const conditions = [];
  const args = [];

  for (
    const token
    of tokens
  ) {
    const pattern =
      `%${token}%`;

    conditions.push(`
      (
        lower(title) LIKE ?
        OR lower(snippet) LIKE ?
        OR lower(description) LIKE ?
        OR lower(tags) LIKE ?
        OR lower(domain) LIKE ?
      )
    `);

    args.push(
      pattern,
      pattern,
      pattern,
      pattern,
      pattern
    );
  }

  const sql = `
    SELECT
      id,
      url,
      domain,
      title,
      snippet,
      description,
      tags,
      base_priority,
      quality,
      impressions,
      clicks,
      last_seen
    FROM pages
    WHERE language = 'ita'
      AND (
        ${conditions.join(" OR ")}
      )
    LIMIT 250
  `;

  const result =
    await db.execute({
      sql,
      args
    });

  const rows =
    result.rows || [];

  return rows
    .map(row => {
      const relevance =
        calculateRelevance(
          row,
          query,
          tokens
        );

      const priority =
        Number(
          row.base_priority || 50
        );

      const quality =
        Number(
          row.quality || 50
        );

      const freshness =
        calculateFreshness(
          row.last_seen
        );

      const behavior =
        calculateBehavior(
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
        id: Number(
          row.id
        ),

        url: String(
          row.url
        ),

        domain: String(
          row.domain || ""
        ),

        title:
          String(
            row.title ||
            row.url
          ),

        description:
          String(
            row.description ||
            row.snippet ||
            "Nessuna descrizione disponibile."
          ),

        snippet:
          String(
            row.snippet || ""
          ),

        tags:
          String(
            row.tags || ""
          ),

        score,

        source:
          "nexanova"
      };
    })
    .sort(
      (a, b) =>
        b.score -
        a.score
    );
}

async function searchWikipedia(
  query
) {
  const params =
    new URLSearchParams({
      action: "query",

      generator: "search",

      gsrsearch: query,

      gsrnamespace: "0",

      gsrlimit: "5",

      prop: "extracts|info",

      exintro: "1",

      explaintext: "1",

      inprop: "url",

      format: "json",

      formatversion: "2"
    });

  const response =
    await fetch(
      `${WIKIPEDIA_API}?${params.toString()}`,
      {
        method: "GET",

        headers: {
          "Accept":
            "application/json",

          "User-Agent":
            "NexaNova/1.0 (https://nexa-nova-ten.vercel.app/)"
        },

        cache: "no-store"
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Wikipedia HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  const pages =
    data?.query?.pages;

  if (
    !Array.isArray(pages)
  ) {
    return [];
  }

  return pages
    .filter(
      page =>
        page &&
        page.ns === 0 &&
        page.title
    )
    .map(
      page => {
        const extract =
          String(
            page.extract || ""
          )
            .replace(
              /\s+/g,
              " "
            )
            .trim();

        const description =
          extract.length > 450
            ? `${extract.slice(
                0,
                450
              )}…`
            : extract;

        return {
          id: null,

          url:
            page.fullurl ||
            `https://it.wikipedia.org/wiki/${encodeURIComponent(
              String(
                page.title
              ).replace(
                / /g,
                "_"
              )
            )}`,

          domain:
            "it.wikipedia.org",

          title:
            String(
              page.title
            ),

          description:
            description ||
            "Articolo Wikipedia",

          snippet:
            description,

          tags:
            "wikipedia",

          score:
            45,

          source:
            "wikipedia"
        };
      }
    );
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
    return json(
      res,
      405,
      {
        error:
          "Method not allowed"
      }
    );
  }

  if (
    !process.env.TURSO_DATABASE_URL ||
    !process.env.TURSO_AUTH_TOKEN
  ) {
    return json(
      res,
      500,
      {
        error:
          "Turso environment variables are missing"
      }
    );
  }

  const query =
    normalizeQuery(
      req.query?.q
    );

  if (!query) {
    return json(
      res,
      200,
      {
        results: [],
        source:
          "nexanova"
      }
    );
  }

  const start =
    performance.now();

  try {
    const [
      dbResult,
      wikipediaResult
    ] =
      await Promise.allSettled([
        searchDatabase(
          query
        ),

        searchWikipedia(
          query
        )
      ]);

    const dbResults =
      dbResult.status ===
      "fulfilled"
        ? dbResult.value
        : [];

    const wikipediaResults =
      wikipediaResult.status ===
      "fulfilled"
        ? wikipediaResult.value
        : [];

    if (
      wikipediaResult.status ===
      "rejected"
    ) {
      console.error(
        "Wikipedia search failed:",
        wikipediaResult.reason
      );
    }

    /*
     * NexaNova resta la fonte principale.
     * Wikipedia viene aggiunta come fonte
     * di conoscenza complementare.
     */
    const finalResults = [
      ...dbResults,
      ...wikipediaResults
    ].slice(
      0,
      50
    );

    const elapsed =
      (
        performance.now() -
        start
      ) / 1000;

    return json(
      res,
      200,
      {
        results:
          finalResults,

        source:
          "nexanova",

        query,

        resultCount:
          finalResults.length,

        elapsed:
          Number(
            elapsed.toFixed(
              3
            )
          )
      }
    );

  } catch (error) {
    console.error(
      "NexaNova search error:",
      error
    );

    return json(
      res,
      500,
      {
        error:
          "Database search failed"
      }
    );
  }
}
