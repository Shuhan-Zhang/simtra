// Image stimuli for the composer. An uploaded picture (storefront, product, ad)
// is downscaled in the browser, described by the backend's vision model as
// neutral attributes, shown to the user as editable chips, and only the
// confirmed attributes travel to residents (`state.stimulus`). Residents never
// see pixels; results are reactions to what is listed here.

export const MAX_STIMULI = 2;
const MAX_EDGE = 1280;      // longest side after downscale
const THUMB_EDGE = 160;
const JPEG_Q = 0.86;

// Decode a File/Blob, downscale to MAX_EDGE, return base64 JPEG + a tiny thumb.
export async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("Drop a JPEG, PNG or WebP image.");
  const bitmap = await loadBitmap(file);
  const data = draw(bitmap, MAX_EDGE).split(",")[1];
  const thumb = draw(bitmap, THUMB_EDGE);
  bitmap.close?.();
  return { media_type: "image/jpeg", data, thumb, name: file.name || "image" };
}

async function loadBitmap(file) {
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}

function draw(src, edge) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const scale = Math.min(1, edge / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);   // PNG alpha → white
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", JPEG_Q);
}

// Plain-text rendering used to fill A/B variants (mirrors Stimulus::to_text in Rust).
export function stimulusText(st) {
  if (!st) return "";
  const lines = [];
  lines.push(`${st.kind ? `[${st.kind}] ` : ""}${st.summary || ""}`.trim());
  for (const [k, v] of Object.entries(st.attributes || {})) lines.push(`- ${k.replace(/_/g, " ")}: ${v}`);
  if (st.unknowns?.length) lines.push(`Not shown: ${st.unknowns.join("; ")}`);
  return lines.join("\n");
}

// Compact read-only rendering of the attributes residents are told about.
export function attributesLine(st) {
  return Object.entries(st?.attributes || {}).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ");
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
