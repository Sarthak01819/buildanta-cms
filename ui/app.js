// buildanta-cms — editor UI. Everything is held in memory until Save; Save
// sends the whole ordered list and the server writes content/world.json.
const TOKEN = document.querySelector('meta[name="cms-token"]').content;
const $ = (s) => document.querySelector(s);
const api = (path, opts = {}) =>
  fetch(path, { ...opts, headers: { "X-CMS-Token": TOKEN, ...(opts.headers || {}) } })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });

const el = {
  status: $("[data-status]"), list: $("[data-list]"), count: $("[data-count]"), save: $("[data-save]"),
  editor: $("[data-editor]"), empty: $("[data-empty]"), media: $("[data-preview-media]"), drop: $("[data-drop]"),
  file: $("[data-file]"), meta: $("[data-meta]"), colorCode: $("[data-color-code]"), preview: $("[data-preview]"),
};
const field = (k) => document.querySelector(`[data-f="${k}"]`);

let projects = [];
let current = -1;
let dirty = false;

const slugOf = (p) => (p.link || "").replace(/^#\/work\//, "");
const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "")
  .trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 48);

function setStatus(text, kind = "") { el.status.textContent = text; el.status.className = `status ${kind}`; }
function markDirty() { dirty = true; el.save.disabled = false; setStatus("Unsaved changes", "dirty"); }

/* ── list ── */
function renderList() {
  el.count.textContent = `${projects.length} projects`;
  el.list.textContent = "";
  projects.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "item" + (i === current ? " on" : "");
    li.draggable = true;
    li.dataset.i = i;
    const thumb = p.type === "video" ? document.createElement("video") : document.createElement("img");
    thumb.className = "thumb";
    thumb.onerror = () => { thumb.removeAttribute("src"); thumb.style.visibility = "hidden"; };   // file missing: keep the row tidy
    if (p.file) { thumb.src = p.file; if (p.type === "video") { thumb.muted = true; thumb.preload = "metadata"; } }
    const t = document.createElement("span"); t.className = "t"; t.textContent = p.title || "(untitled)";
    const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = p.color;
    li.append(thumb, t, dot);
    li.addEventListener("click", () => select(i));
    li.addEventListener("dragstart", (e) => { li.classList.add("drag"); e.dataTransfer.setData("text/plain", String(i)); });
    li.addEventListener("dragend", () => li.classList.remove("drag"));
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("over"); });
    li.addEventListener("dragleave", () => li.classList.remove("over"));
    li.addEventListener("drop", (e) => {
      e.preventDefault(); li.classList.remove("over");
      const from = Number(e.dataTransfer.getData("text/plain")), to = i;
      if (from === to) return;
      const selected = projects[current];
      const [moved] = projects.splice(from, 1);
      projects.splice(to, 0, moved);
      current = projects.indexOf(selected);
      markDirty(); renderList();
    });
    el.list.append(li);
  });
}

/* ── editor ── */
function renderMedia(p) {
  el.media.textContent = "";
  if (!p.file) { el.media.textContent = "No media yet"; return; }
  const m = p.type === "video" ? Object.assign(document.createElement("video"), { muted: true, loop: true, autoplay: true, playsInline: true })
    : document.createElement("img");
  m.src = p.file;
  el.media.append(m);
}
function select(i) {
  current = i;
  const p = projects[i];
  el.editor.hidden = !p;
  if (!p) { renderList(); return; }
  field("title").value = p.title; field("author").value = p.author; field("caption").value = p.caption;
  field("body").value = p.body; field("slug").value = slugOf(p); field("color").value = p.color;
  field("show_caption").checked = p.show_caption;
  el.colorCode.textContent = p.color;
  el.meta.textContent = `${p.type} · ${p.image_size.join(" × ")} px · ${p.file || "no file"}`;
  renderMedia(p);
  renderList();
}

// inputs → model
for (const k of ["title", "author", "caption", "body", "slug", "color"]) {
  field(k).addEventListener("input", () => {
    const p = projects[current]; if (!p) return;
    if (k === "slug") p.link = `#/work/${slugify(field("slug").value) || "project"}`;
    else p[k] = field(k).value;
    if (k === "title" && !p._slugTouched && p._new) { p.link = `#/work/${slugify(p.title)}`; field("slug").value = slugOf(p); }
    if (k === "slug") p._slugTouched = true;
    if (k === "color") el.colorCode.textContent = p.color;
    markDirty();
    if (k === "title" || k === "color") renderList();
  });
}
field("show_caption").addEventListener("change", () => { projects[current].show_caption = field("show_caption").checked; markDirty(); });

/* ── media upload (size read in the browser, file saved by the server) ── */
function measure(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("video")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => { resolve([v.videoWidth, v.videoHeight]); URL.revokeObjectURL(url); };
      v.onerror = () => resolve(null); v.src = url;
    } else {
      const im = new Image();
      im.onload = () => { resolve([im.naturalWidth, im.naturalHeight]); URL.revokeObjectURL(url); };
      im.onerror = () => resolve(null); im.src = url;
    }
  });
}
async function upload(file) {
  const p = projects[current]; if (!p || !file) return;
  const size = await measure(file);
  if (!size) { setStatus("That file couldn't be read as an image or video", "err"); return; }
  setStatus(`Uploading ${file.name}…`);
  try {
    const r = await api(`/api/media?name=${encodeURIComponent(file.name)}&title=${encodeURIComponent(p.title)}`,
      { method: "POST", body: file });
    p.file = r.file; p.type = r.type; p.image_size = size;
    select(current); markDirty();
    setStatus("Uploaded — Save to use it (the old file moves to .trash on save)", "dirty");
  } catch (e) { setStatus(`Upload failed: ${e.message}`, "err"); }
}
el.file.addEventListener("change", () => { upload(el.file.files[0]); el.file.value = ""; });
el.drop.addEventListener("dragover", (e) => { e.preventDefault(); el.drop.classList.add("drop"); });
el.drop.addEventListener("dragleave", () => el.drop.classList.remove("drop"));
el.drop.addEventListener("drop", (e) => { e.preventDefault(); el.drop.classList.remove("drop"); upload(e.dataTransfer.files[0]); });

/* ── new / delete / save ── */
$("[data-new]").addEventListener("click", () => {
  const n = projects.length + 1;
  projects.push({ _new: true, type: "image", title: `New project ${n}`, author: "Buildanta", caption: "", body: "",
    link: `#/work/new-project-${n}`, color: "#3d7bd9", file: "", show_caption: true, gallery: [], image_size: [512, 342] });
  markDirty(); select(projects.length - 1);
  field("title").focus(); field("title").select();
});
$("[data-delete]").addEventListener("click", () => {
  const p = projects[current]; if (!p) return;
  if (!confirm(`Delete "${p.title}"?\n\nIt is removed when you Save; its media file moves to .trash (not deleted).`)) return;
  projects.splice(current, 1);
  markDirty(); select(Math.min(current, projects.length - 1));
});
el.save.addEventListener("click", async () => {
  el.save.disabled = true; setStatus("Saving…");
  try {
    const body = JSON.stringify({ projects: projects.map(({ _new, _slugTouched, ...p }) => p) });
    const r = await api("/api/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    dirty = false;
    projects.forEach((p) => { delete p._new; delete p._slugTouched; });
    setStatus(`Saved ${r.count} projects${r.trashed.length ? ` · ${r.trashed.length} old file(s) moved to .trash` : ""} — the local site updates now; push to go live`, "ok");
  } catch (e) { el.save.disabled = false; setStatus(`Not saved: ${e.message}`, "err"); }
});
addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (dirty) el.save.click(); } });

/* ── boot ── */
api("/api/projects").then((r) => {
  projects = r.projects;
  el.preview.href = r.previewUrl;
  setStatus(`${projects.length} projects · editing ${r.site.split(/[\/]/).pop()}`);
  el.status.title = r.site;   // full path on hover
  renderList();
}).catch((e) => setStatus(`Couldn't load projects: ${e.message}`, "err"));
