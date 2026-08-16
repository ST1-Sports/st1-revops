const DEFAULT_MODEL = "claude-sonnet-4-6";

function extractText(data) {
  return (data?.content || [])
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("");
}

export function parseJsonLoose(raw) {
  const text = String(raw || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try { return JSON.parse(text); } catch {}

  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    try { return JSON.parse(text.slice(objStart, objEnd + 1)); } catch {}
  }

  return null;
}

async function callAnthropicJson({ system, prompt, maxTokens = 7000 }) {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_KEY not configured");

  const model = process.env.KNOWLEDGE_ANTHROPIC_MODEL || DEFAULT_MODEL;
  console.info("[knowledge/ai] calling Anthropic", { model, maxTokens });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const bodyText = await response.text();
  let data;
  try { data = JSON.parse(bodyText); } catch {
    throw new Error(`Anthropic returned non-JSON: ${bodyText.slice(0, 240)}`);
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || `Anthropic ${response.status}`);
  }

  const raw = extractText(data);
  const parsed = parseJsonLoose(raw);
  if (!parsed) throw new Error("AI response did not contain valid JSON");
  return parsed;
}

export function createKnowledgeAiProvider() {
  const provider = process.env.KNOWLEDGE_AI_PROVIDER || "anthropic";
  if (provider !== "anthropic") {
    throw new Error(`Unsupported KNOWLEDGE_AI_PROVIDER: ${provider}`);
  }

  return {
    provider,
    async json(args) {
      return callAnthropicJson(args);
    },
  };
}
