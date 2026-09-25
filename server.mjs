/**
 * buildanta-cms — the local project editor for the Buildanta site.
 *
 * The "backend" is the site's own content, unchanged: it reads and writes
 *   <site>/content/world.json      the Projects world (58 cards, in order)
 *   <site>/public/world/art/       the cards' images / videos
 * exactly as the site's build reads them. The editor is a separate repo and a
 * separate server, so none of it ever ships with the website.
 *
 * Local-only by design:
 *   · binds 127.0.0.1 — nothing off this computer can connect;
 *   · rejects any Host header that is not localhost (DNS-rebinding guard);
 *   · every write needs this run's random token AND a localhost Origin, so a
 *     web page open in the same browser cannot post to it (CSRF guard);
 *   · uploads: whitelisted media types only, names are generated server-side,
 *     paths can never leave the media folder;
 *   · nothing is ever deleted: replaced / orphaned media moves to .trash/,
 *     and every save keeps the previous world.json in .backup/.
 *
 * Zero dependencies. `npm start` (Node 18+).
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5300);
const SITE = path.resolve(HERE, process.env.SITE_DIR || "../buildanta-site-optimized");
const WORLD_JSON = path.join(SITE, "content", "world.json");
const SITE_JSON = path.join(SITE, "content", "site.json");
const REEL_DIR = path.join(SITE, "public", "assets", "reel");
const REEL_URL = "/assets/reel/";
const ART_DIR = path.join(SITE, "public", "world", "art");
const ART_URL = "/world/art/";
const TRASH = path.join(HERE, ".trash");
const BACKUP = path.join(HERE, ".backup");
const UI = path.join(HERE, "ui");
const TOKEN = crypto.randomBytes(24).toString("hex");
const MAX_UPLOAD = 300 * 1024 * 1024;   // 300 MB

const MEDIA = { ".jpg": "image", ".jpeg": "image", ".png": "image", ".webp": "image", ".mp4": "video" };
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
};

if (!fs.existsSync(WORLD_JSON)) {
  console.error(`\n  Can't find the site's content at:\n  ${WORLD_JSON}\n\n  Put buildanta-cms next to the site folder, or run with SITE_DIR=<path to the site>.\n`);
  process.exit(1);
}

/* ── helpers ─────────────────────────────────────────────────────────── */
const send = (res, code, body, type = "application/json; charset=utf-8") => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const localHost = (h = "") => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);
const readBody = (req, limit) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});
/** a media URL from world.json → absolute path inside ART_DIR, or null */
const artPath = (url) => {
  if (typeof url !== "string") return null;
  const name = path.basename(url.replace(/^\/art\//, ART_URL));
  if (!url.startsWith(ART_URL) && !url.startsWith("/art/")) return null;
  const p = path.join(ART_DIR, name);
  return p.startsWith(ART_DIR + path.sep) ? p : null;
};
const slug = (s) => String(s || "project").toLowerCase().normalize("NFKD")
  .replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 48) || "project";

async function readWorld() { return JSON.parse(await fsp.readFile(WORLD_JSON, "utf8")); }
async function readSite() { return JSON.parse(await fsp.readFile(SITE_JSON, "utf8")); }
/** reel art: a bare file name inside public/assets/reel/, or null */
const reelPath = (name) => {
  if (typeof name !== "string" || !name || name !== path.basename(name)) return null;
  const p = path.join(REEL_DIR, name);
  return p.startsWith(REEL_DIR + path.sep) ? p : null;
};
async function backup(file, tag) {
  await fsp.mkdir(BACKUP, { recursive: true });
  await fsp.copyFile(file, path.join(BACKUP, `${tag}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
}
async function writeJson(file, data) {
  const tmp = file + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await fsp.rename(tmp, file);
}
/** one reel plate, in the shape src/modules/services.js reads */
function cleanService(s, i) {
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const id = String(s.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  if (!id) throw new Error(`Service ${i + 1}: needs an id`);
  if (s.art && !reelPath(s.art)) throw new Error(`Service ${i + 1}: art must be a file in ${REEL_URL}`);
  return {
    id,
    art: str(s.art, 120),
    tag: str(s.tag, 120),
    who: str(s.who, 400),
    gets: (Array.isArray(s.gets) ? s.gets : []).map((g) => str(g, 200)).filter(Boolean).slice(0, 8),
    line: str(s.line, 200),
    what: str(s.what, 1200),
    word: str(s.word, 40) || id.toUpperCase(),
    position: (i + 1) * 10,
  };
}

/** Validate + normalise one card to the exact shape the site reads. */
function clean(p, i) {
  const s = (v, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
  const file = s(p.file, 300);
  const ext = path.extname(file).toLowerCase();
  if (file && !artPath(file)) throw new Error(`Card ${i + 1}: media path must be inside ${ART_URL}`);
  const size = Array.isArray(p.image_size) && p.image_size.length === 2
    ? p.image_size.map((n) => Math.max(1, Math.round(Number(n) || 0))) : [512, 342];
  return {
    type: MEDIA[ext] || (p.type === "video" ? "video" : "image"),
    title: s(p.title, 120) || `Project ${i + 1}`,
    author: s(p.author, 120),
    caption: s(p.caption, 300),
    link: /^#\/work\/[\w-]+$/.test(p.link || "") ? p.link : `#/work/${slug(p.title)}`,
    color: /^#[0-9a-fA-F]{6}$/.test(p.color || "") ? p.color : "#888888",
    file,
    show_caption: p.show_caption !== false,
    body: s(p.body, 8000),
    gallery: Array.isArray(p.gallery) ? p.gallery.filter((g) => typeof g === "string" && artPath(g)).slice(0, 40) : [],
    image_size: size,
  };
}

/* ── server ──────────────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  try {
    if (!localHost(req.headers.host)) return send(res, 403, { error: "local only" });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const write = req.method !== "GET" && req.method !== "HEAD";
    if (write) {
      const origin = req.headers.origin;
      if ((origin && !localHost(origin.replace(/^https?:\/\//, ""))) || req.headers["x-cms-token"] !== TOKEN) {
        return send(res, 403, { error: "forbidden" });
      }
    }

    // UI + the token (the page reads it once; other sites can't read our responses)
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = (await fsp.readFile(path.join(UI, "index.html"), "utf8")).replace("__CMS_TOKEN__", TOKEN);
      return send(res, 200, html, MIME[".html"]);
    }
    if (req.method === "GET" && /^\/(app\.js|services\.js|app\.css|logo\.webp)$/.test(url.pathname)) {
      const f = path.join(UI, url.pathname.slice(1));
      return send(res, 200, await fsp.readFile(f), MIME[path.extname(f)] || "application/octet-stream");
    }
    // the site's media, for thumbnails
    if (req.method === "GET" && url.pathname.startsWith(ART_URL)) {
      const f = artPath(decodeURIComponent(url.pathname));
      if (!f || !fs.existsSync(f)) return send(res, 404, { error: "not found" });
      return send(res, 200, await fsp.readFile(f), MIME[path.extname(f).toLowerCase()] || "application/octet-stream");
    }

    if (url.pathname === "/api/projects" && req.method === "GET") {
      return send(res, 200, { projects: await readWorld(), site: SITE, previewUrl: "http://localhost:5303/" });
    }

    if (url.pathname === "/api/projects" && req.method === "PUT") {
      const incoming = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString("utf8"));
      if (!Array.isArray(incoming?.projects)) return send(res, 400, { error: "expected { projects: [] }" });
      let next;
      try { next = incoming.projects.map(clean); } catch (e) { return send(res, 400, { error: e.message }); }
      const links = new Set();
      for (const p of next) {
        if (links.has(p.link)) return send(res, 400, { error: `Two projects share the link ${p.link}` });
        links.add(p.link);
      }
      const prev = await readWorld();
      // back up, then write atomically
      await fsp.mkdir(BACKUP, { recursive: true });
      await fsp.writeFile(path.join(BACKUP, `world-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
        JSON.stringify(prev, null, 2) + "\n");
      const tmp = WORLD_JSON + ".tmp";
      await fsp.writeFile(tmp, JSON.stringify(next, null, 2) + "\n");
      await fsp.rename(tmp, WORLD_JSON);
      // media no card uses any more → .trash/ (never deleted)
      const used = new Set(next.flatMap((p) => [p.file, ...p.gallery]).map(artPath).filter(Boolean));
      const orphaned = [...new Set(prev.flatMap((p) => [p.file, ...(p.gallery || [])]).map(artPath).filter(Boolean))]
        .filter((f) => !used.has(f) && fs.existsSync(f));
      await fsp.mkdir(TRASH, { recursive: true });
      for (const f of orphaned) await fsp.rename(f, path.join(TRASH, `${Date.now()}-${path.basename(f)}`));
      return send(res, 200, { ok: true, count: next.length, trashed: orphaned.map((f) => path.basename(f)) });
    }

    // ── services (the camera reel), content/site.json "service.*" ──
    if (url.pathname === "/api/services" && req.method === "GET") {
      const site = await readSite();
      const services = Object.entries(site).filter(([k]) => k.startsWith("service.")).map(([, v]) => v)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      return send(res, 200, { services });
    }
    if (url.pathname === "/api/services" && req.method === "PUT") {
      const incoming = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString("utf8"));
      if (!Array.isArray(incoming?.services)) return send(res, 400, { error: "expected { services: [] }" });
      let next;
      try { next = incoming.services.map(cleanService); } catch (e) { return send(res, 400, { error: e.message }); }
      if (new Set(next.map((s) => s.id)).size !== next.length) return send(res, 400, { error: "Two services share an id" });
      const prev = await readSite();
      await backup(SITE_JSON, "site");
      // keep every non-service key where it was; rewrite the service.* set
      const out = {};
      const nextById = new Map(next.map((s) => [s.id, s]));
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith("service.")) out[k] = v;
        else if (nextById.has(v.id)) { out[k] = nextById.get(v.id); nextById.delete(v.id); }
      }
      for (const s of nextById.values()) out[`service.${s.id}`] = s;   // new ones at the end
      await writeJson(SITE_JSON, out);
      // reel art no service uses any more → .trash/
      const used = new Set(next.map((s) => reelPath(s.art)).filter(Boolean));
      const orphaned = [...new Set(Object.entries(prev).filter(([k]) => k.startsWith("service."))
        .map(([, v]) => reelPath(v.art)).filter(Boolean))].filter((f) => !used.has(f) && fs.existsSync(f));
      await fsp.mkdir(TRASH, { recursive: true });
      for (const f of orphaned) await fsp.rename(f, path.join(TRASH, `${Date.now()}-${path.basename(f)}`));
      return send(res, 200, { ok: true, count: next.length, trashed: orphaned.map((f) => path.basename(f)) });
    }
    if (url.pathname === "/api/reel-art" && req.method === "POST") {
      const ext = path.extname(url.searchParams.get("name") || "").toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return send(res, 400, { error: "Use a JPG, PNG or WebP image" });
      const data = await readBody(req, 40 * 1024 * 1024);
      if (!data.length) return send(res, 400, { error: "empty file" });
      const name = `${slug(url.searchParams.get("title"))}-${crypto.randomBytes(3).toString("hex")}${ext === ".jpeg" ? ".jpg" : ext}`;
      await fsp.writeFile(path.join(REEL_DIR, name), data);
      return send(res, 200, { art: name });
    }
    // reel art, for previews
    if (req.method === "GET" && url.pathname.startsWith(REEL_URL)) {
      const f = reelPath(decodeURIComponent(url.pathname.slice(REEL_URL.length)));
      if (!f || !fs.existsSync(f)) return send(res, 404, { error: "not found" });
      return send(res, 200, await fsp.readFile(f), MIME[path.extname(f).toLowerCase()] || "application/octet-stream");
    }

    if (url.pathname === "/api/media" && req.method === "POST") {
      const ext = path.extname(url.searchParams.get("name") || "").toLowerCase();
      if (!MEDIA[ext]) return send(res, 400, { error: "Use a JPG, PNG, WebP image or an MP4 video" });
      const data = await readBody(req, MAX_UPLOAD);
      if (!data.length) return send(res, 400, { error: "empty file" });
      const name = `${slug(url.searchParams.get("title"))}-${crypto.randomBytes(3).toString("hex")}${ext === ".jpeg" ? ".jpg" : ext}`;
      await fsp.writeFile(path.join(ART_DIR, name), data);
      return send(res, 200, { file: ART_URL + name, type: MEDIA[ext] });
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, e.message === "too large" ? 413 : 500, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  buildanta-cms  →  http://localhost:${PORT}`);
  console.log(`  editing        →  ${SITE}`);
  console.log(`  (local only; Ctrl+C to stop)\n`);
});
