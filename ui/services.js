// buildanta-cms — the Services reel tab (content/site.json "service.*").
// Shares the top bar with Projects: body[data-mode] says which tab owns New /
// Save; each tab keeps its own unsaved state.
const TOKEN = document.querySelector('meta[name="cms-token"]').content;
const $ = (s) => document.querySelector(s);
const api = (path, opts = {}) =>
  fetch(path, { ...opts, headers: { "X-CMS-Token": TOKEN, ...(opts.headers || {}) } })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });

const el = {
  status: $("[data-status]"), save: $("[data-save]"), newBtn: $("[data-new]"),
  list: $("[data-s-list]"), count: $("[data-s-count]"), editor: $("[data-s-editor]"),
  art: $("[data-s-art]"), file: $("[data-s-file]"), drop: $("[data-s-drop]"),
};
const f = (k) => document.querySelector(`[data-s="${k}"]`);
let services = [];
let current = -1;
let dirty = false;
let loaded = false;
const mode = () => document.body.dataset.mode || "projects";
const setStatus = (t, k = "") => { el.status.textContent = t; el.status.className = `status ${k}`; };
const markDirty = () => { dirty = true; el.save.disabled = false; setStatus("Unsaved changes (services)", "dirty"); };
const idOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

/* ── tabs ── */
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  const to = b.dataset.tab;
  if (to === mode()) return;
  const projectsDirty = !$("[data-save]").disabled && mode() === "projects";
  if ((mode() === "services" && dirty) || projectsDirty) {
    if (!confirm("You have unsaved changes on this tab. Switch anyway? (They stay until you reload.)")) return;
  }
  document.body.dataset.mode = to;
  document.querySelectorAll("[data-tab]").forEach((t) => t.classList.toggle("on", t.dataset.tab === to));
  document.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== to; });
  el.newBtn.textContent = to === "services" ? "+ New service" : "+ New project";
  document.title = `Buildanta CMS — ${to === "services" ? "Services" : "Projects"}`;
  if (to === "services") {
    el.save.disabled = !dirty;
    if (!loaded) load(); else setStatus(`${services.length} services`);
  } else {
    document.dispatchEvent(new CustomEvent("cms:projects-shown"));
  }
}));

/* ── list ── */
function renderList() {
  el.count.textContent = `${services.length} services`;
  el.list.textContent = "";
  services.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "item" + (i === current ? " on" : "");
    li.draggable = true;
    const img = document.createElement("img");
    img.className = "thumb";
    img.onerror = () => { img.removeAttribute("src"); img.style.visibility = "hidden"; };
    if (s.art) img.src = `/assets/reel/${s.art}`;
    const t = document.createElement("span"); t.className = "t"; t.textContent = s.word || s.id;
    li.append(img, t);
    li.addEventListener("click", () => select(i));
    li.addEventListener("dragstart", (e) => { li.classList.add("drag"); e.dataTransfer.setData("text/plain", String(i)); });
    li.addEventListener("dragend", () => li.classList.remove("drag"));
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("over"); });
    li.addEventListener("dragleave", () => li.classList.remove("over"));
    li.addEventListener("drop", (e) => {
      e.preventDefault(); li.classList.remove("over");
      const from = Number(e.dataTransfer.getData("text/plain"));
      if (from === i) return;
      const sel = services[current];
      const [m] = services.splice(from, 1);
      services.splice(i, 0, m);
      current = services.indexOf(sel);
      markDirty(); renderList();
    });
    el.list.append(li);
  });
}

/* ── editor ── */
function select(i) {
  current = i;
  const s = services[i];
  el.editor.hidden = !s;
  if (!s) { renderList(); return; }
  f("word").value = s.word || "";
  f("id").value = s.id || "";
  f("id").readOnly = !s._new;
  f("line").value = (s.line || "").replace(/<br\s*\/?>/gi, "\n");
  f("tag").value = s.tag || "";
  f("what").value = s.what || "";
  f("who").value = s.who || "";
  f("gets").value = (s.gets || []).join("\n");
  el.art.textContent = "";
  if (s.art) {
    const img = document.createElement("img");
    img.src = `/assets/reel/${s.art}`;
    img.onerror = () => { el.art.textContent = "Image missing"; };
    el.art.append(img);
  } else el.art.textContent = "No image yet";
  renderList();
}
for (const k of ["word", "id", "line", "tag", "what", "who", "gets"]) {
  f(k).addEventListener("input", () => {
    const s = services[current]; if (!s) return;
    const v = f(k).value;
    if (k === "line") s.line = v.split("\n").map((x) => x.trim()).filter(Boolean).join("<br>");
    else if (k === "gets") s.gets = v.split("\n").map((x) => x.trim()).filter(Boolean);
    else if (k === "id") s.id = idOf(v);
    else s[k] = v;
    if (k === "word" && s._new && !s._idTouched) { s.id = idOf(v); f("id").value = s.id; }
    if (k === "id") s._idTouched = true;
    markDirty();
    if (k === "word") renderList();
  });
}

/* ── art upload ── */
async function uploadArt(file) {
  const s = services[current]; if (!s || !file) return;
  setStatus(`Uploading ${file.name}…`);
  try {
    const r = await api(`/api/reel-art?name=${encodeURIComponent(file.name)}&title=${encodeURIComponent(s.word || s.id)}`,
      { method: "POST", body: file });
    s.art = r.art; select(current); markDirty();
    setStatus("Image uploaded — Save to use it (the old one moves to .trash on save)", "dirty");
  } catch (e) { setStatus(`Upload failed: ${e.message}`, "err"); }
}
el.file.addEventListener("change", () => { uploadArt(el.file.files[0]); el.file.value = ""; });
el.drop.addEventListener("dragover", (e) => { e.preventDefault(); el.drop.classList.add("drop"); });
el.drop.addEventListener("dragleave", () => el.drop.classList.remove("drop"));
el.drop.addEventListener("drop", (e) => { e.preventDefault(); el.drop.classList.remove("drop"); uploadArt(e.dataTransfer.files[0]); });

/* ── new / delete / save (only while this tab is open) ── */
el.newBtn.addEventListener("click", () => {
  if (mode() !== "services") return;
  services.push({ _new: true, id: `service-${services.length + 1}`, word: "NEW", line: "", tag: "", what: "", who: "", gets: [], art: "" });
  markDirty(); select(services.length - 1); f("word").focus(); f("word").select();
});
$("[data-s-delete]").addEventListener("click", () => {
  const s = services[current]; if (!s) return;
  if (!confirm(`Delete the "${s.word || s.id}" plate?\n\nIt is removed when you Save; its image moves to .trash (not deleted).`)) return;
  services.splice(current, 1); markDirty(); select(Math.min(current, services.length - 1));
});
el.save.addEventListener("click", async () => {
  if (mode() !== "services") return;
  el.save.disabled = true; setStatus("Saving services…");
  try {
    const body = JSON.stringify({ services: services.map(({ _new, _idTouched, ...s }) => s) });
    const r = await api("/api/services", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    dirty = false; services.forEach((s) => { delete s._new; delete s._idTouched; });
    if (current >= 0) f("id").readOnly = true;
    setStatus(`Saved ${r.count} services${r.trashed.length ? ` · ${r.trashed.length} old image(s) moved to .trash` : ""} — the local site updates now; push to go live`, "ok");
  } catch (e) { el.save.disabled = false; setStatus(`Not saved: ${e.message}`, "err"); }
});
addEventListener("keydown", (e) => {
  if (mode() === "services" && (e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (dirty) el.save.click(); }
});
addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

function load() {
  api("/api/services").then((r) => {
    services = r.services; loaded = true;
    setStatus(`${services.length} services`);
    renderList();
  }).catch((e) => setStatus(`Couldn't load services: ${e.message}`, "err"));
}
