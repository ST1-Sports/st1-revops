// URL ↔ module mapping for RevOps page navigation.
// Sidebar modules used to live only in React state, so the browser back
// button had nothing to restore. Each module now has a real path.

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
  "social",
  "marketing",
  "compete",
  "agent",
  "activity",
  "settings",
  "admin",
  "integrations",
  "reddit",
  "price-lists",
  "expansion",
  "calendar",
]);

export const MOD_ALIASES = {
  home: "briefing",
  campaigns: "marketing",
  prices: "price-lists",
  competitors: "compete",
  "command-center": "cc-ad-hub",
  "ai-knowledge": "integrations",
};

export const PROSPECT_TABS = new Set(["areas", "results", "import", "lists"]);

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
  return PROSPECT_TABS.has(tab) ? tab : "areas";
}

export function prospectPath(tab) {
  if (!tab || tab === "areas") return "/prospecting";
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
