// ─────────────────────────────────────────────────────────────────────────
// sim francisco · the city feed, as a floating panel over the map
//
// A thread of what happened in the city and how its synthetic residents took
// it, laid out like the news bubble it replaces: a dated entry per event with
// the residents' reactions quoted under it, and every question asked of the
// city as a dated entry too, so the lineage of "world changed → we measured"
// reads top to bottom.
//
// Data: events + tests come from the persona-memory lineage endpoint; reactions
// are one batched model call per request over a diverse sample of residents,
// stored on the graph so everyone sees the same thread. The city's baseline
// headlines (what residents already know) sit at the bottom as plain posts.
// ─────────────────────────────────────────────────────────────────────────

import { BASE, today } from "./config.js";

const SENTIMENTS = ["support", "oppose", "worried", "angry", "sad", "hopeful", "indifferent"];
const REACT_N = 12;
const REFRESH_MS = 20000;
const LINEAGE_LIMIT = 100;
const PREVIEW_POSTS = 5;   // event posts near the top fetch their comment previews lazily
const PREVIEW_N = 3;
const COLLAPSE_KEY = "simtra.feed.collapsed";
const TEST_KINDS = {
  poll: "poll",
  ab_test: "A/B test",
  counterfactual_baseline: "baseline",
  counterfactual_exposed: "with hypothetical",
  predict_market: "market",
  validate: "validation",
};

// ── http ───────────────────────────────────────────────────────────────────
async function req(path, { method = "GET", body, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const error = new Error(data?.error || data?.message || res.statusText);
      error.status = res.status;
      throw error;
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") {
      const error = new Error("the backend took too long to answer");
      error.status = 504;
      throw error;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const api = {
  lineage: (city, limit = LINEAGE_LIMIT) =>
    req(`/cities/${encodeURIComponent(city)}/lineage?limit=${limit}`, { timeout: 20000 }),
  events: (city, limit = 50) =>
    req(`/cities/${encodeURIComponent(city)}/events?limit=${limit}`, { timeout: 20000 }),
  postEvent: (city, body) =>
    req(`/cities/${encodeURIComponent(city)}/events`, { method: "POST", body, timeout: 20000 }),
  reactions: (city, eventId, limit = 50) =>
    req(`/cities/${encodeURIComponent(city)}/events/${encodeURIComponent(eventId)}/reactions?limit=${limit}`,
      { timeout: 20000 }),
  react: (branchId, eventId, n = REACT_N) =>
    req(`/branches/${encodeURIComponent(branchId)}/events/${encodeURIComponent(eventId)}/react`,
      { method: "POST", body: { n }, timeout: 120000 }),
  poll: (branchId, body) =>
    req(`/branches/${encodeURIComponent(branchId)}/poll`, { method: "POST", body, timeout: 180000 }),
};

// ── helpers ────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sentimentOf = (s) => (SENTIMENTS.includes(s) ? s : "indifferent");
function friendly(error) {
  const s = error?.status;
  if (s === 503) return "Persona memory is not configured on this backend.";
  if (s === 429 || s === 502) return "Residents are rate-limited right now. Try again in a minute.";
  if (s === 504) return "The backend took too long to answer. Try again.";
  if (s === 404) return "That no longer exists on the backend.";
  return error?.message || "Something went wrong.";
}
function tally(reactions) {
  const out = {};
  for (const r of reactions || []) {
    const s = sentimentOf(r.sentiment);
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}
function fmtDate(iso) {
  // date-only strings are calendar dates, not UTC instants: keep them local
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
  if (isNaN(d.getTime())) return iso || "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;

// ── state ──────────────────────────────────────────────────────────────────
const state = {
  getCity: () => "sf",
  getBranch: () => null,
  getCityDisplay: () => "San Francisco",
  getResidents: () => 0,
  getNews: () => [],
  items: [],            // lineage items (events + tests), newest first
  posts: new Map(),     // item id -> post element
  memoryOff: false,
  lineageOff: false,
  busy: 0,              // in-flight reacts (pauses refresh)
  autoCollapsed: false, // folded away while a result card is up; not persisted
  collapsed: false,
  refreshTimer: null,
  loadSeq: 0,
  root: null,
  el: {},
};

// ── skeleton ───────────────────────────────────────────────────────────────
const ICONS = {
  caret: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5z"/></svg>`,
  comment: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 5H4v10h5l3 3 3-3h5z"/></svg>`,
};
const initials = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
};

function build(root) {
  root.innerHTML = `
    <div class="fp-head">
      <button class="fp-collapse" type="button" aria-expanded="true" aria-controls="fp-body">
        <span class="fp-lockup">
          <span class="fp-kicker">timeline</span>
          <span class="fp-city"></span>
        </span>
        <span class="fp-caret">${ICONS.caret}</span>
      </button>
      <div class="fp-status" aria-live="polite"></div>
    </div>
    <div id="fp-body" class="fp-body">
      <div class="fp-composer">
        <form class="fp-form fp-form-post" data-mode="post">
          <textarea class="fp-text" name="text" rows="2" maxlength="2000" required
                    placeholder="Add something the residents will remember…"
                    aria-label="What happened"></textarea>
          <div class="fp-row">
            <select class="fp-select" name="kind" aria-label="Kind of event">
              <option value="news">news</option>
              <option value="policy">policy</option>
              <option value="incident">incident</option>
              <option value="rumor">rumor</option>
            </select>
            <input class="fp-date-input" type="date" name="as_of_date" aria-label="Date it happened" />
            <button class="fp-primary" type="submit">Remember</button>
          </div>
          <div class="fp-error" role="alert"></div>
        </form>
      </div>
      <div class="fp-notice hidden" role="status"></div>
      <div class="fp-thread"></div>
    </div>`;
  const q = (s) => root.querySelector(s);
  state.el = {
    collapse: q(".fp-collapse"),
    city: q(".fp-city"),
    status: q(".fp-status"),
    body: q("#fp-body"),
    formPost: q(".fp-form-post"),
    notice: q(".fp-notice"),
    thread: q(".fp-thread"),
  };
  state.el.formPost.elements.as_of_date.value = today();
}

// ── public api ─────────────────────────────────────────────────────────────
export function initFeedPanel({ getCity, getBranch, getCityDisplay, getResidents, getNews } = {}) {
  const root = document.getElementById("feed-panel");
  if (!root) return;
  state.root = root;
  if (getCity) state.getCity = getCity;
  if (getBranch) state.getBranch = getBranch;
  if (getCityDisplay) state.getCityDisplay = getCityDisplay;
  if (getResidents) state.getResidents = getResidents;
  if (getNews) state.getNews = getNews;
  build(root);

  try { state.collapsed = localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { /* private mode */ }
  applyCollapsed();
  state.el.collapse.addEventListener("click", () => {
    state.autoCollapsed = false;
    state.collapsed = !state.collapsed;
    try { localStorage.setItem(COLLAPSE_KEY, state.collapsed ? "1" : "0"); } catch { /* ignore */ }
    applyCollapsed();
  });

  state.el.formPost.addEventListener("submit", postEvent);
  for (const f of [state.el.formPost]) {
    f.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); }
    });
  }
  // the map listens for wheel / pointer on the canvas; keep the panel's own
  // scrolling and typing from leaking into camera or the "/" shortcut
  for (const ev of ["wheel", "pointerdown", "keydown"]) root.addEventListener(ev, (e) => e.stopPropagation());

  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshFeedPanel({ quiet: true }); });
  watchResultCard();
  scheduleRefresh();
  root.classList.remove("hidden");
  refreshFeedPanel();
}

// Reload the thread for the current city. Called by the app when the city
// changes or the simulation finishes waking (branch id becomes available).
export async function refreshFeedPanel({ quiet = false } = {}) {
  if (!state.root) return;
  const city = state.getCity();
  const seq = ++state.loadSeq;
  syncHeader();
  if (!quiet) { state.el.thread.setAttribute("aria-busy", "true"); }
  try {
    const items = await loadItems(city);
    if (seq !== state.loadSeq) return;
    state.memoryOff = false;
    state.items = items;
    notice("");
    renderThread();
    syncHeader();
    previewComments(city);
  } catch (e) {
    if (seq !== state.loadSeq) return;
    if (e.status === 503) {
      state.memoryOff = true;
      state.items = [];
      renderThread();
      notice("Persona memory is not configured on this backend, so residents cannot remember or react.");
    } else if (!quiet) {
      notice(friendly(e));
    }
    syncHeader();
  } finally {
    state.el.thread.removeAttribute("aria-busy");
  }
}

async function loadItems(city) {
  if (!state.lineageOff) {
    try {
      const data = await api.lineage(city);
      return (data.items || []).slice().reverse();
    } catch (e) {
      if (e.status !== 404) throw e;
      state.lineageOff = true;
    }
  }
  const data = await api.events(city);
  return (data.events || []).map((ev) => ({ type: "event", ...ev }));
}

function scheduleRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    if (document.hidden || state.memoryOff || state.busy > 0 || state.collapsed) return;
    refreshFeedPanel({ quiet: true });
  }, REFRESH_MS);
}

// ── header / chrome ────────────────────────────────────────────────────────
function syncHeader() {
  const { el } = state;
  el.city.textContent = state.getCityDisplay();
  const branch = state.getBranch();
  const n = state.getResidents();
  const events = state.items.filter((i) => i.type === "event").length;
  const asks = state.items.filter((i) => i.type === "test").length;
  let status;
  if (state.memoryOff) status = "memory off";
  else if (!branch) status = "waking the residents…";
  else status = `${n.toLocaleString()} residents`;
  if (events || asks) {
    status = `${plural(events, "event")} · ${plural(asks, "question")} in memory · ${status}`;
  }
  el.status.textContent = status;
  const canWrite = !!branch && !state.memoryOff;
  for (const f of [el.formPost]) {
    const btn = f.querySelector(".fp-primary");
    btn.disabled = !canWrite;
    btn.title = canWrite ? "" : (state.memoryOff ? "persona memory is off" : "wait for the residents to wake");
  }
}

// The result card and the panel share the right side of the map. While a
// result is up, fold the panel away; put it back when the card goes. This is
// a temporary state and never touches the remembered preference.
function watchResultCard() {
  const card = document.getElementById("result-card");
  if (!card || typeof MutationObserver === "undefined") return;
  const apply = () => {
    const visible = !card.classList.contains("hidden");
    if (visible && !state.collapsed) {
      state.autoCollapsed = true;
      state.collapsed = true;
      applyCollapsed();
    } else if (!visible && state.autoCollapsed) {
      state.autoCollapsed = false;
      state.collapsed = false;
      applyCollapsed();
    }
  };
  new MutationObserver(apply).observe(card, { attributes: true, attributeFilter: ["class"] });
  apply();
}

function applyCollapsed() {
  state.root.dataset.collapsed = state.collapsed ? "true" : "false";
  state.el.collapse.setAttribute("aria-expanded", state.collapsed ? "false" : "true");
  state.el.body.hidden = state.collapsed;
  syncHeader();
}

function notice(text) {
  state.el.notice.textContent = text;
  state.el.notice.classList.toggle("hidden", !text);
}

// ── thread ─────────────────────────────────────────────────────────────────
function renderThread() {
  const { thread } = state.el;
  const seen = new Set();
  const frag = document.createDocumentFragment();
  for (const item of state.items) {
    seen.add(item.id);
    let post = state.posts.get(item.id);
    if (!post) {
      post = item.type === "test" ? testPost(item) : eventPost(item);
      state.posts.set(item.id, post);
    } else if (post.dataset.busy !== "true") {
      // refresh the parts that can change between loads
      if (item.type === "test") fillTest(post, item); else fillEvent(post, item);
    }
    frag.appendChild(post);
  }
  for (const id of [...state.posts.keys()]) if (!seen.has(id)) state.posts.delete(id);
  // the city's baseline headlines: what residents already know, as plain posts
  const news = state.getNews() || [];
  for (const a of news.slice(0, 6)) frag.appendChild(newsPost(a));
  if (!state.items.length && !news.length) {
    const empty = document.createElement("div");
    empty.className = "fp-empty";
    empty.textContent = state.memoryOff
      ? "Nothing to remember while persona memory is off."
      : "The residents remember nothing yet. Add an event and see how they take it.";
    frag.appendChild(empty);
  }
  thread.replaceChildren(frag);
}

// fetch a few comments for the event posts near the top (best-effort)
async function previewComments(city) {
  const targets = state.items.filter((i) => i.type === "event" && (i.reaction_count || 0) > 0).slice(0, PREVIEW_POSTS);
  await Promise.all(targets.map(async (item) => {
    if (item.reactions?.length) return;
    try {
      const data = await api.reactions(city, item.id, PREVIEW_N);
      if (city !== state.getCity()) return;
      const live = state.items.find((e) => e.id === item.id);
      const post = state.posts.get(item.id);
      if (!live || !post || post.dataset.busy === "true") return;
      live.reactions = data.reactions || [];
      // keep the lineage tally: this call is limited to PREVIEW_N rows, so its
      // own sentiment map only covers those
      if (!(live.sentiment && Object.keys(live.sentiment).length) && data.sentiment) live.sentiment = data.sentiment;
      fillEvent(post, live);
    } catch { /* preview only */ }
  }));
}

// ── posts: the news bubble's entry ─────────────────────────────────────────
// uppercase date · kind label, then a bold headline; everything else is quiet.
const dateLabel = (parts) => `<div class="fp-date">${parts.filter(Boolean).map(esc).join(" · ")}</div>`;
const postHead = ({ avatar, avatarClass = "", source = "", date = "" }) => `
    <div class="fp-post-head">
      <span class="fp-avatar ${avatarClass}">${esc(avatar)}</span>
      <span class="fp-source">${esc(source)}</span>
      <span class="fp-date">${esc(date)}</span>
    </div>`;

// ── event post ─────────────────────────────────────────────────────────────
function eventPost(item) {
  const post = document.createElement("article");
  post.className = "fp-post fp-post-event";
  post.dataset.id = item.id;
  post.innerHTML = `
    ${postHead({ avatar: "n", avatarClass: "fp-avatar-event", source: "", date: "" })}
    <div class="fp-title"></div>
    <div class="fp-engage" aria-hidden="true">
      <span class="fp-eng"><i class="fp-ico">${ICONS.heart}</i><span class="fp-eng-n"></span></span>
      <span class="fp-eng"><i class="fp-ico">${ICONS.comment}</i><span class="fp-eng-n"></span></span>
    </div>
    <div class="fp-crowd" aria-hidden="true"></div>
    <div class="fp-reacted"></div>
    <div class="fp-comments"></div>
    <div class="fp-post-actions"></div>`;
  fillEvent(post, item);
  return post;
}

function fillEvent(post, item, { pending = 0 } = {}) {
  const kind = item.kind || "news";
  post.querySelector(".fp-avatar").textContent = kind[0];
  post.querySelector(".fp-source").textContent = `${state.getCity()} · ${kind}`;
  post.querySelector(".fp-date").textContent = fmtDate(item.as_of_date);
  post.querySelector(".fp-title").textContent = item.text || "";
  const counts = item.sentiment && Object.keys(item.sentiment).length ? item.sentiment : tally(item.reactions);
  const total = item.reaction_count || Object.values(counts).reduce((a, b) => a + b, 0);
  const [heartN, commentN] = post.querySelectorAll(".fp-eng-n");
  heartN.textContent = total ? total.toLocaleString() : "";
  commentN.textContent = total ? total.toLocaleString() : "";

  // crowd strip: one square per resident, grouped by sentiment in canonical order
  const crowd = post.querySelector(".fp-crowd");
  const squares = [];
  for (const s of SENTIMENTS) for (let i = 0; i < (counts[s] || 0); i++) squares.push(`<i data-s="${s}"></i>`);
  for (let i = 0; i < pending; i++) squares.push(`<i class="fp-sq-pending"></i>`);
  crowd.innerHTML = squares.join("");
  crowd.classList.toggle("hidden", !squares.length);

  const reacted = post.querySelector(".fp-reacted");
  if (total) {
    const parts = SENTIMENTS.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`);
    reacted.textContent = [`${plural(total, "resident")} reacted`, ...parts].join(" · ");
  } else {
    reacted.textContent = pending ? "residents are reacting…" : "no reactions yet";
  }

  const comments = post.querySelector(".fp-comments");
  const shown = (item.reactions || []).slice(0, 3);
  comments.innerHTML = shown.map(commentNode).join("");
  if (pending) comments.insertAdjacentHTML("beforeend", `<div class="fp-skel"><i></i></div>`.repeat(2));

  renderEventActions(post, item, { busy: pending > 0 });
}

function commentNode(r) {
  const s = sentimentOf(r.sentiment);
  const who = [r.occupation, r.neighborhood].filter(Boolean).join(" · ");
  return `
    <div class="fp-comment">
      <span class="fp-avatar fp-avatar-sm" data-s="${s}">${esc(initials(r.name))}</span>
      <div class="fp-comment-body">
        <div class="fp-comment-text"><b>${esc(r.name)}</b> ${esc(r.text)} <span class="fp-comment-s">${s}</span></div>
        ${who ? `<div class="fp-comment-who">${esc(who)}</div>` : ""}
      </div>
    </div>`;
}

function renderEventActions(post, item, { busy = false, note = "", error = false } = {}) {
  const box = post.querySelector(".fp-post-actions");
  if (!box) return;
  box.replaceChildren();
  if (busy) return;
  const total = item.reaction_count || 0;
  const shown = (item.reactions || []).length;
  const branch = state.getBranch();
  const link = (text, onClick, primary = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = primary ? "fp-link fp-link-primary" : "fp-link";
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  };
  if (total > shown) box.appendChild(link(`View all ${total} comments`, () => showAll(item.id)));
  if (branch && !state.memoryOff) {
    box.appendChild(link(total ? `Ask ${REACT_N} more residents` : "Ask residents", () => reactTo(item.id), !total));
  }
  if (note) {
    const n = document.createElement("span");
    n.className = error ? "fp-note fp-note-error" : "fp-note";
    n.textContent = note;
    box.appendChild(n);
  }
}

async function showAll(eventId) {
  const item = state.items.find((e) => e.id === eventId);
  const post = state.posts.get(eventId);
  if (!item || !post) return;
  renderEventActions(post, item, { note: "loading…" });
  try {
    const data = await api.reactions(state.getCity(), eventId);
    item.reactions = data.reactions || [];
    item.reaction_count = Math.max(item.reaction_count || 0, item.reactions.length);
    if (data.sentiment && Object.keys(data.sentiment).length) item.sentiment = data.sentiment;
    fillEvent(post, item);
    post.querySelector(".fp-comments").innerHTML = item.reactions.map(commentNode).join("");
    renderEventActions(post, { ...item, reactions: item.reactions });
  } catch (e) {
    renderEventActions(post, item, { note: friendly(e), error: true });
  }
}

async function reactTo(eventId, { pending = REACT_N } = {}) {
  const item = state.items.find((e) => e.id === eventId);
  const post = state.posts.get(eventId);
  const branch = state.getBranch();
  if (!item || !post || !branch) return;
  post.dataset.busy = "true";
  state.busy++;
  fillEvent(post, item, { pending });
  try {
    const res = await api.react(branch, eventId, pending);
    const fresh = res.reactions || [];
    const counts = { ...(item.sentiment || {}) };
    for (const r of fresh) { const s = sentimentOf(r.sentiment); counts[s] = (counts[s] || 0) + 1; }
    item.sentiment = counts;
    item.reaction_count = (item.reaction_count || 0) + fresh.length;
    item.reactions = [...fresh, ...(item.reactions || [])];
    post.dataset.busy = "false";
    fillEvent(post, item);
  } catch (e) {
    post.dataset.busy = "false";
    fillEvent(post, item);
    renderEventActions(post, item, { note: friendly(e), error: true });
  } finally {
    state.busy--;
  }
}

// ── test post ──────────────────────────────────────────────────────────────
function testPost(item) {
  const post = document.createElement("article");
  post.className = "fp-post fp-post-test";
  post.dataset.id = item.id;
  post.innerHTML = `
    ${postHead({ avatar: "?", avatarClass: "fp-avatar-ask", source: "you asked", date: "" })}
    <div class="fp-title"></div>
    <div class="fp-result"></div>
    <div class="fp-bar" aria-hidden="true"><i class="fp-bar-yes"></i><i class="fp-bar-no"></i></div>
    <div class="fp-memory"></div>
    <div class="fp-hypo hidden"></div>`;
  fillTest(post, item);
  return post;
}

function fillTest(post, item) {
  const kind = TEST_KINDS[item.kind] || item.kind || "poll";
  post.querySelector(".fp-date").textContent = [fmtWhen(item.created_at), kind].join(" · ");
  post.querySelector(".fp-title").textContent = item.question || "";
  const p = Number.isFinite(item.p_yes) ? item.p_yes : 0;
  const pct = Math.round(p * 100);
  post.querySelector(".fp-bar-yes").style.width = `${pct}%`;
  const framing = item.framing === "belief" ? "say it will happen" : "would vote yes";
  const meta = [item.n_agents ? `${item.n_agents.toLocaleString()} residents` : "", item.model || ""].filter(Boolean).join(" · ");
  post.querySelector(".fp-result").innerHTML = `<b>${pct}% ${framing}</b>${meta ? ` <span class="fp-muted">· ${esc(meta)}</span>` : ""}`;
  const mem = post.querySelector(".fp-memory");
  const known = Number.isFinite(item.events_known) ? item.events_known : null;
  let memHtml = known === null ? "" : `asked with ${plural(known, "event")} in memory`;
  const pts = Number.isFinite(item.delta) ? Math.round(item.delta * 100) : 0;
  if (pts !== 0) {
    memHtml += ` <span class="fp-delta" data-dir="${pts > 0 ? "up" : "down"}">${pts > 0 ? "+" : ""}${pts} pts since last asked</span>`;
  }
  mem.innerHTML = memHtml;
  mem.classList.toggle("hidden", !memHtml);
  const hypo = post.querySelector(".fp-hypo");
  hypo.textContent = item.under_event ? `under hypothetical: ${item.under_event}` : "";
  hypo.classList.toggle("hidden", !item.under_event);
}

// ── baseline headlines ─────────────────────────────────────────────────────
function newsPost(a) {
  const post = document.createElement("article");
  post.className = "fp-post fp-post-news";
  post.innerHTML = `
    ${postHead({ avatar: "d", avatarClass: "fp-avatar-desk", source: "city desk", date: a.date ? fmtDate(a.date) : "" })}
    <div class="fp-title"></div>
    <div class="fp-sum"></div>`;
  post.querySelector(".fp-title").textContent = a.headline || "";
  post.querySelector(".fp-sum").textContent = a.summary || "";
  return post;
}

// ── composer actions ───────────────────────────────────────────────────────
async function postEvent(ev) {
  ev.preventDefault();
  const f = state.el.formPost;
  const err = f.querySelector(".fp-error");
  err.textContent = "";
  const text = f.elements.text.value.trim();
  const as_of_date = f.elements.as_of_date.value || today();
  const kind = f.elements.kind.value || "news";
  if (!text) { err.textContent = "Write what happened first."; f.elements.text.focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(as_of_date)) { err.textContent = "Pick a valid date."; return; }
  const btn = f.querySelector(".fp-primary");
  btn.disabled = true; btn.textContent = "Remembering…";
  try {
    const { event } = await api.postEvent(state.getCity(), { text, as_of_date, kind });
    f.elements.text.value = "";
    const item = { type: "event", ...event, reaction_count: 0, sentiment: {}, reactions: [] };
    state.items = [item, ...state.items.filter((e) => e.id !== item.id)];
    renderThread();
    state.el.body.scrollTo({ top: state.el.thread.offsetTop - 8, behavior: "smooth" });
    reactTo(item.id);
  } catch (e) {
    err.textContent = friendly(e);
  } finally {
    btn.textContent = "Remember";
    syncHeader();
  }
}

