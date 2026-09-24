function getHost(rawUrl) {
    try {
        return new URL(rawUrl).hostname
            .toLowerCase()
            .replace(/^www\./, "");
    } catch {
        return "";
    }
}

function getDomainQuality(host) {
    if (!host) return 0.4;

    const highQualityDomains = [
        "wikipedia.org",
        "github.com",
        "stackoverflow.com",
        "stackexchange.com",
        "mozilla.org",
        "python.org",
        "arxiv.org",
        "nature.com",
        "reuters.com",
        "apnews.com",
        "bbc.com",
        "microsoft.com",
        "apple.com",
        "google.com",
        "nvidia.com",
        "openai.com",
        "cloudflare.com",
        "developer.mozilla.org",
        "docs.python.org"
    ];

    if (
        highQualityDomains.some(
            domain => host === domain || host.endsWith("." + domain)
        )
    ) {
        return 1.0;
    }

    if (
        host.endsWith(".gov") ||
        host.endsWith(".edu") ||
        host.endsWith(".edu.it")
    ) {
        return 0.95;
    }

    if (host.endsWith(".eu")) {
        return 0.85;
    }

    return 0.55;
}

function getRegionAdjustment(host) {
    // Non blocca i domini russi:
    // li penalizza soltanto nelle ricerche generiche.
    if (
        host.endsWith(".ru") ||
        host.endsWith(".рф") ||
        host === "yandex.ru" ||
        host === "ya.ru" ||
        host === "mail.ru"
    ) {
        return 0.65;
    }

    return 1.0;
}

function rankResult(result, originalIndex) {
    const host = getHost(result.url);

    const searxScore = Number(result.score);

    const relevance =
        Number.isFinite(searxScore) && searxScore > 0
            ? searxScore
            : 1 / (originalIndex + 1);

    const engineCount = Array.isArray(result.engines)
        ? result.engines.length
        : result.engine
            ? 1
            : 0;

    const consensus = Math.min(engineCount / 4, 1);

    const originalPosition =
        1 / (originalIndex + 1);

    const domainQuality =
        getDomainQuality(host);

    const regionAdjustment =
        getRegionAdjustment(host);

    /*
      NexaRank v0.1

      50% = rilevanza
      20% = consenso tra motori
      15% = posizione originale
      15% = qualità dominio
    */

    const score =
        (
            relevance * 0.50 +
            consensus * 0.20 +
            originalPosition * 0.15 +
            domainQuality * 0.15
        ) * regionAdjustment;

    return {
        title: result.title || host || "Risultato",
        url: result.url || "#",
        description: result.content || "",
        domain: host,
        score: Number(score.toFixed(5))
    };
}

function deduplicate(results) {
    const seen = new Set();

    return results.filter(result => {
        try {
            const url = new URL(result.url);

            url.hash = "";

            const normalized = url
                .toString()
                .replace(/\/$/, "");

            if (seen.has(normalized)) {
                return false;
            }

            seen.add(normalized);
            return true;
        } catch {
            return false;
        }
    });
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");

    const query = String(req.query?.q || "").trim();

    if (!query) {
        return res.status(400).json({
            results: [],
            error: "Query mancante"
        });
    }

    if (query.length > 200) {
        return res.status(400).json({
            results: [],
            error: "Query troppo lunga"
        });
    }

    /*
      Inserisci qui una istanza SearXNG pubblica
      che supporti format=json.

      Meglio usare la variabile Vercel SEARXNG_URL,
      così puoi cambiare istanza senza modificare il codice.
    */

    const searxngUrl =
        process.env.SEARXNG_URL ||
        "https://SEARXNG-INSTANCE-DA-SCEGLIERE";

    try {
        const searchUrl = new URL(
            "/search",
            searxngUrl
        );

        searchUrl.searchParams.set(
            "q",
            query
        );

        searchUrl.searchParams.set(
            "format",
            "json"
        );

        searchUrl.searchParams.set(
            "language",
            "all"
        );

        searchUrl.searchParams.set(
            "safesearch",
            "1"
        );

        searchUrl.searchParams.set(
            "pageno",
            "1"
        );

        const response = await fetch(
            searchUrl,
            {
                headers: {
                    Accept: "application/json",
                    "User-Agent":
                        "NexaNova/1.0"
                },
                signal: AbortSignal.timeout(8000)
            }
        );

        if (!response.ok) {
            throw new Error(
                `SearXNG HTTP ${response.status}`
            );
        }

        const data =
            await response.json();

        const rawResults =
            Array.isArray(data.results)
                ? data.results
                : [];

        const results =
            deduplicate(
                rawResults.map(
                    (result, index) =>
                        rankResult(
                            result,
                            index
                        )
                )
            )
            .sort(
                (a, b) =>
                    b.score - a.score
            )
            .slice(0, 50);

        return res.status(200).json({
            query,
            results,
            source: "searxng"
        });

    } catch (error) {
        console.error(
            "NexaNova SearXNG error:",
            error
        );

        return res.status(502).json({
            results: [],
            error:
                "Motore di ricerca temporaneamente non disponibile."
        });
    }
}
