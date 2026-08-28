// mind-board-pet — 本地服务（src/server/app.mjs）
// 127.0.0.1:13134 —— 数据 API + 静态渲染页。
// 由 Electron 主进程内嵌启动；也可以 node src/server/app.mjs 独立跑（浏览器/Edge 兜底模式）。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as store from "../core/store.mjs";
import { statusLine } from "../core/protocol.mjs";

export const PORT = Number(process.env.MIND_BOARD_PORT || 13134);
const RENDERER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "renderer");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function send(res, code, body, headers = {}) {
  const h = { ...headers };
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    h["Content-Type"] ||= MIME[extname(String(headers.__path || "")) || ".html"];
  }
  delete h.__path;
  res.writeHead(code, h);
  res.end(body);
}

function json(res, obj) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

/** POST 路由通用守卫：非法 JSON 一律 400，绝不静默当 {} 处理（会假装成功） */
function badJson(res) {
  return json(res, { ok: false, message: "请求体不是合法 JSON" });
}

async function route(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path.startsWith("/api/")) {
    const q = url.searchParams;
    switch (true) {
      case req.method === "GET" && path === "/api/overview":
        return json(res, store.overview());
      case req.method === "GET" && path === "/api/skeleton": {
        const data = store.fullSkeleton(q.get("id"));
        return data ? json(res, data) : send(res, 404, '{"error":"not found"}', { "Content-Type": MIME[".json"], __path: "" });
      }
      case req.method === "GET" && path === "/api/statusline": {
        const ov = store.overview();
        // 归一化后再比：query 里的 cwd 可能是正斜杠，projectDir 是反斜杠
        const dir = resolve(q.get("cwd") || process.cwd()).toLowerCase();
        const hit = ov.projects.find((p) => p.projectDir && resolve(p.projectDir).toLowerCase() === dir);
        return send(res, 200, statusLine(hit || null), { "Content-Type": "text/plain; charset=utf-8", __path: "" });
      }
      case req.method === "GET" && path === "/api/journal":
        return json(res, store.journalTail(Number(q.get("after") || 0)));
      case req.method === "POST" && path === "/api/organize": {
        const body = await readBody(req);
        if (!body) return badJson(res);
        let rec;
        try {
          rec = body.projectId
            ? (store.fullSkeleton(body.projectId) ? { id: body.projectId } : null)
            : null;
        } catch {}
        if (!rec) rec = store.resolveProject(body.cwd || process.cwd(), body.harness || "panel");
        return json(res, store.organize(rec.id, { ...body, harness: body.harness || "panel" }));
      }
      case req.method === "POST" && path === "/api/action": {
        const body = await readBody(req);
        if (!body) return badJson(res);
        if (!body.projectId || !body.action) return json(res, { ok: false, message: "projectId/action 必填" });
        // delete 之后骨架已不存在，返回前不读全量
        const r = store.controlAction(body.projectId, { action: body.action, params: body.params || {} });
        return json(res, r);
      }
      case req.method === "POST" && path === "/api/mode": {
        const body = await readBody(req);
        if (!body) return badJson(res);
        store.writeSettings({ mode: body.mode === "on" ? "on" : "off" });
        return json(res, { ok: true, settings: store.readSettings() });
      }
      case req.method === "POST" && path === "/api/prefs": {
        const body = await readBody(req);
        if (!body) return badJson(res);
        const patch = {};
        if (typeof body.tutorialDone === "boolean") patch.tutorialDone = body.tutorialDone;
        if (["s", "m", "l"].includes(body.fontSize)) patch.fontSize = body.fontSize;
        if (["georgia", "song", "sans", "kai", "hei"].includes(body.fontFamily)) patch.fontFamily = body.fontFamily;
        if ([1, 2, 3].includes(Number(body.organizeInterval))) patch.organizeInterval = Number(body.organizeInterval);
        if (["ink", "cream"].includes(body.panelTheme)) patch.panelTheme = body.panelTheme;
        if (["zh", "en"].includes(body.language)) patch.language = body.language;
        if (Array.isArray(body.greetings)) patch.greetings = body.greetings.filter((g) => typeof g === "string").slice(0, 12);
        if (body.modules && typeof body.modules === "object") {
          const cur = store.readSettings().modules;
          const mm = { ...cur };
          for (const k of ["juggle", "autoJuggle", "speech", "tutorial", "celebrate"]) {
            if (typeof body.modules[k] === "boolean") mm[k] = body.modules[k];
          }
          patch.modules = mm;
        }
        store.writeSettings(patch);
        return json(res, { ok: true, settings: store.readSettings() });
      }
      case req.method === "GET" && path === "/api/export": {
        const data = JSON.stringify(store.exportAll(), null, 2);
        return send(res, 200, data, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="mind-board-export.json"',
          __path: "",
        });
      }
      case req.method === "POST" && path === "/api/import": {
        const body = await readBody(req);
        if (!body) return badJson(res);
        return json(res, store.importAll(body));
      }
      default:
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end('{"error":"no such api"}');
    }
  }

  // 静态文件（渲染页）
  let rel = path === "/" ? "/pet.html" : path;
  const file = join(RENDERER_DIR, rel.replace(/^\/+/, ""));
  if (!file.startsWith(RENDERER_DIR)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  } catch {
    res.writeHead(500); res.end();
  }
}

/** 启动服务。若端口已被本应用占用则复用（isReused=true）。 */
export function startServer(port = PORT) {
  return new Promise((resolveP) => {
    const srv = createServer((req, res) => {
      route(req, res).catch((e) => {
        try {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e?.message || e) }));
        } catch {}
      });
    });
    srv.on("error", async (err) => {
      if (err.code === "EADDRINUSE") {
        // 探测是否就是本服务在跑
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/overview`);
          const j = await r.json();
          resolveP({ port, isReused: j.server === "mind-board-pet", reused: j.server === "mind-board-pet", server: j.server });
        } catch {
          resolveP({ port, isReused: false, conflict: true });
        }
        return;
      }
      throw err;
    });
    srv.listen(port, "127.0.0.1", () => resolveP({ port, isReused: false }));
  });
}

// 独立运行入口：node src/server/app.mjs
const selfFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedFile && selfFile.toLowerCase() === invokedFile.toLowerCase()) {
  startServer().then(({ port }) => console.log(`[mind-board-pet] http://127.0.0.1:${port}/pet.html`));
}
