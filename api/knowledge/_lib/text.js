import crypto from "crypto";

export const SOURCE_TYPES = new Set(["PASTE", "URL", "FILE", "EMAIL", "MANUAL"]);

export function normalizeSourceType(value) {
  const normalized = String(value || "PASTE").trim().toUpperCase();
  return SOURCE_TYPES.has(normalized) ? normalized : "PASTE";
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text || "", "utf8").digest("hex");
}

export function cleanText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function stripHtml(html) {
  return cleanText(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
}

export async function fetchUrlText(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error("A valid URL is required");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "ST1KnowledgeBot/1.0 (+https://st1sports.com)",
      "Accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
    },
  });
  if (!response.ok) throw new Error(`URL fetch failed with HTTP ${response.status}`);

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  const limited = raw.slice(0, 1_000_000);
  const text = contentType.includes("html") ? stripHtml(limited) : cleanText(limited);
  if (!text) throw new Error("No readable text found at URL");
  return { text, contentType };
}

export function decodeBase64Text(fileBase64) {
  if (!fileBase64) return "";
  const raw = String(fileBase64).includes(",")
    ? String(fileBase64).split(",").pop()
    : String(fileBase64);
  return cleanText(Buffer.from(raw, "base64").toString("utf8"));
}

export function chunkText(text, maxChars = 2800, overlapChars = 250) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).trim().length <= maxChars) {
      current = (current ? current + "\n\n" : "") + paragraph;
      continue;
    }
    if (current) chunks.push(current);

    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    for (let i = 0; i < paragraph.length; i += maxChars - overlapChars) {
      chunks.push(paragraph.slice(i, i + maxChars));
    }
    current = "";
  }

  if (current) chunks.push(current);
  return chunks.map((content, chunkIndex) => ({
    chunkIndex,
    content,
    metadata: {
      charLength: content.length,
      approxTokens: Math.ceil(content.length / 4),
    },
  }));
}

export function findBestChunk(chunks, extraction) {
  const quote = String(extraction?.sourceQuote || extraction?.payload?.sourceQuote || "").trim();
  const entityName = String(extraction?.entityName || "").trim();
  const needle = quote || entityName;
  if (!needle) return null;
  const low = needle.toLowerCase().slice(0, 180);
  return chunks.find(chunk => chunk.content.toLowerCase().includes(low)) || null;
}
