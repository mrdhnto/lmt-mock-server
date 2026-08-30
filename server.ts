// LMT Mock Server — receives anonymous-report POSTs (Supabase replacement).
// Usage:  bun run server.ts
//         PORT=3001 bun run server.ts

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = parseInt(process.env.PORT || "3001", 10);
const db = Database.open(":memory:");

// Load privacy.md from disk
const privacyMd = readFileSync(join(import.meta.dir, "privacy.md"), "utf-8");

// ── Schema ─────────────────────────────────────────────────────────────────

db.run(`
  CREATE TABLE reports (
    id        TEXT PRIMARY KEY,
    created   TEXT NOT NULL DEFAULT (datetime('now')),
    series    TEXT NOT NULL,
    chapter   TEXT NOT NULL,
    page      INTEGER NOT NULL,
    bboxes    TEXT NOT NULL,          -- JSON-encoded array
    image_url TEXT NOT NULL,          -- Image or page URL
    client_ip TEXT                    -- Client IP address
  )
`);

// ── Types ──────────────────────────────────────────────────────────────────

interface ReportBody {
  seriesName: string;
  chapterId: string;
  pageIndex: number;
  bboxes: { x1: number; y1: number; x2: number; y2: number; confidence: number }[];
  imageUrl?: string;
  imageBase64?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Expose-Headers": "Content-Type",
  };
}

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function bad(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// ── Routes ─────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // GET /privacy — return privacy.md as plain text
    if (method === "GET" && url.pathname === "/privacy") {
      return new Response(privacyMd, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() },
      });
    }

    // GET /reports — list all stored reports
    if (method === "GET" && url.pathname === "/reports") {
      const rows = db.query("SELECT * FROM reports ORDER BY created DESC").all();
      return ok(rows);
    }

    // GET /reports/:id — single report
    if (method === "GET" && url.pathname.startsWith("/reports/")) {
      const id = url.pathname.slice("/reports/".length);
      const row = db.query("SELECT * FROM reports WHERE id = ?").get(id);
      if (!row) return bad("Not found", 404);
      return ok(row);
    }

    // POST on any path (the extension sends to the full supabase REST URL,
    // which may be e.g. /rest/v1/bbox_data — we accept whatever path)
    if (method === "POST") {
      let body: ReportBody;
      try {
        body = await req.json();
      } catch {
        return bad("Invalid JSON body");
      }

      if (!body.seriesName || !body.chapterId || body.pageIndex === undefined) {
        return bad("Missing required fields: seriesName, chapterId, pageIndex");
      }

      const id = randomUUID();
      const imageUrl = body.imageUrl ?? body.imageBase64 ?? "";
      db.query(`
        INSERT INTO reports (id, series, chapter, page, bboxes, image_url, client_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        body.seriesName,
        body.chapterId,
        body.pageIndex,
        JSON.stringify(body.bboxes ?? []),
        imageUrl,
        "127.0.0.1",
      );

      const row = db.query("SELECT * FROM reports WHERE id = ?").get(id);

      // The extension ignores the response body (.catch(() => {})), but
      // returning a proper 201 matches what a real Supabase REST endpoint
      // would do.
      return ok(row, 201);
    }

    // Fallback
    return bad(`Not found: ${method} ${url.pathname}`, 404);
  },
});

// ── Startup ────────────────────────────────────────────────────────────────

console.log(`\n  LMT Mock Server\n`);
console.log(`  GET   → /privacy        → serve privacy.md`);
console.log(`  POST  → *               → store anonymous report`);
console.log(`  GET   → /reports        → list all reports`);
console.log(`  GET   → /reports/:id    → single report`);
console.log(`\n  Listening on http://localhost:${PORT}\n`);