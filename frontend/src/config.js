// ─────────────────────────────────────────────────────────────────────────
// SimFrancisco · pixel-map frontend · configuration
// ─────────────────────────────────────────────────────────────────────────

// This frontend requires the Jev backend from this branch. Local pages use the
// local server by default. Hosted pages require an explicit HTTPS backend origin;
// they must never fall back to the older public service or a visitor's localhost.
const LOCATION = globalThis.location;
const QUERY = new URLSearchParams(LOCATION?.search ?? "");
const LOCAL_HOST = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(LOCATION?.hostname);
const LOCAL_PORT = (() => {
  const raw = Number(QUERY.get("port"));
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : 8080;
})();
function httpsOrigin(value) {
  try {
    const url = new URL(typeof value === "string" ? value.trim() : "");
    return url.protocol === "https:" && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash ? url.origin : "";
  } catch { return ""; }
}
const CONFIGURED_BACKEND = httpsOrigin(QUERY.get("backend")) || httpsOrigin(globalThis.SIMTRA_BACKEND);
const LOCAL_BACKEND = LOCAL_HOST && (QUERY.get("backend") === "local" || !CONFIGURED_BACKEND);
export const BASE = LOCAL_BACKEND ? `http://localhost:${LOCAL_PORT}` : CONFIGURED_BACKEND;
export const BACKEND_SETUP_MESSAGE = "Set SIMTRA_BACKEND in backend-config.js to your Jev server's HTTPS origin.";

// Synthetic population to spin up on load. 10,000 agents → a denser, more diverse
// crowd; poll latency stays bounded because agents are clustered into ≤160 archetypes
// before Jev is called, so the call count (not N) sets the wait.
export const SIM = {
  n: 10000,
  seed: 42,
  start_datetime: "2026-06-13T08:00:00Z",
  tick_seconds: 30,
};

// Today's date as YYYY-MM-DD (UTC).
export function today() {
  return new Date().toISOString().slice(0, 10);
}

// Jev is the live provider. Old links carrying another provider's model name
// use the pinned Jev default; no browser credential or legacy provider fallback.
const JEV_MODELS = new Set(["jev-1.13.0", "jev-latest", "jev-preview"]);
const REQUESTED_MODEL = QUERY.get("model");
const AS_OF_OVERRIDE = /^\d{4}-\d{2}-\d{2}$/.test(QUERY.get("as_of") || "") ? QUERY.get("as_of") : null;
export const PREDICT = {
  branch_ticks: 2,
  as_of_date: AS_OF_OVERRIDE || today(),
  model: JEV_MODELS.has(REQUESTED_MODEL) ? REQUESTED_MODEL : "jev-1.13.0",
};

// Animation timing (ms).
export const TIMING = {
  revealMs: 3000,         // green/red verdicts accumulate over the crowd
  driftMs: 9000,
  fadeBackMs: 420,
};

// Pixel-art map base (whole-city render from the golden-future-map track) + the
// 16×16 RPG character sprite sheet (01-generic: 10 characters).
export const MAP = {
  base: "assets/sf_tiles.png",        // 2144×1920 whole-city LOD-4 tile render
  sprites: "assets/sprites.png",      // 240×128, 10 chars in 5×2 blocks of 48×64
  // WGS-84 bbox the base image spans (from tiles.db manifest).
  bbox: { west: -122.5247, east: -122.3366, south: 37.6983, north: 37.8312 },
  detailZoomMul: 6.5,                 // click-to-zoom factor over the fit-to-screen zoom
};

// Neutral palette (purple removed). Map colors now come from the pixel image;
// these drive UI chrome + the yes/no verdict markers.
export const COLORS = {
  water:   "#215C81",   // exact ocean color in sf_tiles.png → letterbox blends seamlessly
  ink:     "#141414",   // primary text / title — near-black
  inkSoft: "#6E7280",   // secondary text / neutral sprites
  accent:  "#141414",   // was violet — now neutral black
  yes:     "#2E9B4E",   // strong yes — green
  no:      "#C0352F",   // strong no — brick red
};
