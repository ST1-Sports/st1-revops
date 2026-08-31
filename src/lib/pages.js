// URL ↔ module mapping so sidebar pages are real browser history entries.

export const KNOWN_MODS = new Set([
  "briefing",
  "alerts",
  "analytics",
  "crm",
  "sponsorships",
  "deals",
  "orders",
  "reorder",
  "prospecting",
  "bulk-outreach",
  "social",
  "reddit",
  "compete",
  "agent",
  "activity",
  "settings",
  "admin",
  "integrations",
  "price-lists",
  "edgar",
  "expansion",
  "finance",
  "team-stores",
  "flagship-store",
  "cc-ad-hub",
  "calendar",
  "marketing",
]);

export const MOD_ALIASES = {
  home: "briefing",
  campaigns: "prospecting",
  prices: "price-lists",
  competitors: "compete",
  "command-center": "cc-ad-hub",
  "ai-knowledge": "integrations",
};

export const PROSPECT_TABS = new Set([
  "brad",
  "contacts",
  "areas",
  "campaigns",
  "import",
  "results",
  "lists",
]);

export function pathToMod(pathname) {
  const raw = (pathname || "/").replace(/\/+$/, "") || "/";
  if (raw === "/") return "briefing";
  const slug = raw.slice(1).split("/")[0];
  if (MOD_ALIASES[slug]) return MOD_ALIASES[slug];
  if (KNOWN_MODS.has(slug)) return slug;
  if (slug.startsWith("cc-")) return slug;
  return "briefing";
}

export function modToPath(id) {
  if (!id || id === "briefing" || id === "home") return "/";
  const resolved = MOD_ALIASES[id] || id;
  if (resolved === "briefing") return "/";
  return `/${resolved}`;
}

export function prospectTabFromSearch(search) {
  const tab = new URLSearchParams(search || "").get("tab");
  return PROSPECT_TABS.has(tab) ? tab : "brad";
}

export function prospectPath(tab) {
  if (!tab || tab === "brad") return "/prospecting";
  return `/prospecting?tab=${encodeURIComponent(tab)}`;
}

export function crmPath({ contactId, school } = {}) {
  const p = new URLSearchParams();
  if (contactId) p.set("c", contactId);
  if (school) p.set("school", school);
  const q = p.toString();
  return q ? `/crm?${q}` : "/crm";
}

export function integrationsPath(tab) {
  if (!tab || tab === "overview") return "/integrations";
  return `/integrations?tab=${encodeURIComponent(tab)}`;
}
