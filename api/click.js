import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function registerClick(pageId) {
  const day = todayUtc();

  await db.batch([
    {
      sql: `
        UPDATE pages
        SET clicks = clicks + 1
        WHERE id = ?
      `,
      args: [pageId]
    },
    {
      sql: `
        INSERT INTO daily_stats (
          page_id,
          day,
          impressions,
          clicks
        )
        VALUES (?, ?, 0, 1)
        ON CONFLICT(page_id, day)
        DO UPDATE SET clicks = daily_stats.clicks + 1
      `,
      args: [pageId, day]
    }
  ]);
}

async function registerImpressions(pageIds) {
  const day = todayUtc();

  const statements = [];

  for (const pageId of pageIds) {
    statements.push({
      sql: `
        UPDATE pages
        SET impressions = impressions + 1
        WHERE id = ?
      `,
      args: [pageId]
    });

    statements.push({
      sql: `
        INSERT INTO daily_stats (
          page_id,
          day,
          impressions,
          clicks
        )
        VALUES (?, ?, 1, 0)
        ON CONFLICT(page_id, day)
        DO UPDATE SET impressions =
          daily_stats.impressions + 1
      `,
      args: [pageId, day]
    });
  }

  if (statements.length) {
    await db.batch(statements);
  }
}

export default async function handler(req, res) {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    return json(res, 500, {
      error: "Turso environment variables are missing"
    });
  }

  try {
    let payload = {};

    if (req.method === "POST") {
      if (typeof req.body === "string") {
        try {
          payload = JSON.parse(req.body);
        } catch {
          payload = {};
        }
      } else {
        payload = req.body || {};
      }
    } else if (req.method === "GET") {
      payload = {
        action: req.query?.action || "click",
        pageId: req.query?.pageId || req.query?.id
      };
    } else {
      return json(res, 405, { error: "Method not allowed" });
    }

    const action = String(payload.action || "click");

    if (action === "click") {
      const pageId = Number(payload.pageId);

      if (!Number.isInteger(pageId) || pageId <= 0) {
        return json(res, 400, { error: "Invalid pageId" });
      }

      await registerClick(pageId);

      return json(res, 200, { ok: true });
    }

    if (action === "impression") {
      const ids = Array.isArray(payload.pageIds)
        ? payload.pageIds
            .map(Number)
            .filter(id => Number.isInteger(id) && id > 0)
            .slice(0, 20)
        : [];

      if (!ids.length) {
        return json(res, 400, { error: "No valid pageIds" });
      }

      await registerImpressions(ids);

      return json(res, 200, {
        ok: true,
        count: ids.length
      });
    }

    return json(res, 400, {
      error: "Unknown action"
    });
  } catch (error) {
    console.error("NexaNova stats error:", error);

    return json(res, 500, {
      error: "Stats update failed"
    });
  }
}
