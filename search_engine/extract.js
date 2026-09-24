import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";

function decodeHtml(buffer) {
  return buffer.toString("utf8");
}

function extractHttpBody(buffer) {
  let data = buffer;

  if (
    data.length >= 2 &&
    data[0] === 0x1f &&
    data[1] === 0x8b
  ) {
    data = gunzipSync(data);
  }

  const firstHeaderEnd = data.indexOf(
    Buffer.from("\r\n\r\n")
  );

  if (firstHeaderEnd === -1) {
    return data;
  }

  const httpStart = firstHeaderEnd + 4;

  const secondHeaderEnd = data.indexOf(
    Buffer.from("\r\n\r\n"),
    httpStart
  );

  if (secondHeaderEnd === -1) {
    return data.subarray(httpStart);
  }

  const bodyStart = secondHeaderEnd + 4;

  return data.subarray(bodyStart);
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function makeSnippet(text, max = 300) {
  const value = cleanText(text);

  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max).trim()}…`;
}

export function extractPage(buffer, fallbackUrl) {
  const body = extractHttpBody(buffer);
  const html = decodeHtml(body);

  const $ = cheerio.load(html);

  $("script, style, noscript, template, svg").remove();

  const title =
    cleanText($("title").first().text()) ||
    fallbackUrl;

  const description =
    cleanText(
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      ""
    );

  const keywords =
    cleanText(
      $('meta[name="keywords"]').attr("content") ||
      ""
    );

  const canonical =
    cleanText(
      $('link[rel="canonical"]').attr("href") ||
      ""
    );

  const bodyText = cleanText(
    $("body").text()
  );

  const snippet = makeSnippet(
    description || bodyText
  );

  const quality = calculateQuality({
    title,
    description,
    bodyText
  });

  return {
    url: canonical || fallbackUrl,
    title: title.slice(0, 500),
    description: description.slice(0, 1000),
    snippet: snippet.slice(0, 500),
    tags: keywords.slice(0, 500),
    quality
  };
}

function calculateQuality({
  title,
  description,
  bodyText
}) {
  let score = 50;

  if (title.length >= 15) score += 10;
  if (title.length >= 30) score += 5;

  if (description.length >= 40) score += 10;
  if (description.length >= 120) score += 5;

  if (bodyText.length >= 500) score += 10;
  if (bodyText.length >= 2000) score += 10;

  if (bodyText.length < 150) score -= 25;

  return Math.max(
    0,
    Math.min(100, score)
  );
}

export async function fetchAndExtract(record) {
  const offset = Number(record.offset);
  const length = Number(record.length);

  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    length <= 0
  ) {
    throw new Error("Invalid Common Crawl range");
  }

  const url =
    `https://data.commoncrawl.org/${record.filename}`;

  const end = offset + length - 1;

  const response = await fetch(url, {
    headers: {
      Range: `bytes=${offset}-${end}`
    }
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(
      `WARC range failed: HTTP ${response.status}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return extractPage(
    buffer,
    String(record.url)
  );
}
