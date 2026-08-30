export interface Env {
  DB: D1Database;
  RATE_LIMITER?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
  CLIENT_INGEST_KEY?: string;
  ADMIN_API_KEY?: string;
}

interface Bbox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

interface ReportBody {
  seriesName: string;
  chapterId: string;
  pageIndex: number;
  bboxes: Bbox[];
  imageUrl: string;
}

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100KB (JSON with URL + bboxes)
const MAX_BBOXES = 100;
const MAX_STRING_LEN = 200;
const MAX_URL_LEN = 2048;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
  "Access-Control-Expose-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function bad(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

function validateBbox(b: unknown): b is Bbox {
  if (typeof b !== "object" || b === null) return false;
  const item = b as Record<string, unknown>;
  return (
    typeof item.x1 === "number" &&
    Number.isFinite(item.x1) &&
    typeof item.y1 === "number" &&
    Number.isFinite(item.y1) &&
    typeof item.x2 === "number" &&
    Number.isFinite(item.x2) &&
    typeof item.y2 === "number" &&
    Number.isFinite(item.y2) &&
    typeof item.confidence === "number" &&
    Number.isFinite(item.confidence) &&
    item.confidence >= 0 &&
    item.confidence <= 1
  );
}

function validateReport(body: unknown): { valid: true; data: ReportBody } | { valid: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Invalid JSON object" };
  }

  const r = body as Record<string, unknown>;

  if (typeof r.seriesName !== "string" || r.seriesName.trim().length === 0) {
    return { valid: false, error: "Missing or invalid seriesName" };
  }
  if (r.seriesName.length > MAX_STRING_LEN) {
    return { valid: false, error: `seriesName exceeds ${MAX_STRING_LEN} characters` };
  }

  if (typeof r.chapterId !== "string" || r.chapterId.trim().length === 0) {
    return { valid: false, error: "Missing or invalid chapterId" };
  }
  if (r.chapterId.length > MAX_STRING_LEN) {
    return { valid: false, error: `chapterId exceeds ${MAX_STRING_LEN} characters` };
  }

  if (typeof r.pageIndex !== "number" || !Number.isInteger(r.pageIndex) || r.pageIndex < 0 || r.pageIndex > 1000) {
    return { valid: false, error: "pageIndex must be an integer between 0 and 1000" };
  }

  if (!Array.isArray(r.bboxes)) {
    return { valid: false, error: "bboxes must be an array" };
  }
  if (r.bboxes.length > MAX_BBOXES) {
    return { valid: false, error: `bboxes count exceeds maximum limit of ${MAX_BBOXES}` };
  }
  for (const b of r.bboxes) {
    if (!validateBbox(b)) {
      return { valid: false, error: "One or more bounding boxes have invalid coordinates or confidence" };
    }
  }

  if (typeof r.imageUrl !== "string" || r.imageUrl.trim().length === 0) {
    return { valid: false, error: "Missing or invalid imageUrl" };
  }
  if (r.imageUrl.length > MAX_URL_LEN) {
    return { valid: false, error: `imageUrl exceeds maximum limit of ${MAX_URL_LEN} characters` };
  }

  return {
    valid: true,
    data: {
      seriesName: r.seriesName.trim(),
      chapterId: r.chapterId.trim(),
      pageIndex: r.pageIndex,
      bboxes: r.bboxes as Bbox[],
      imageUrl: r.imageUrl.trim(),
    },
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);
      const method = req.method;

      // 1. CORS Preflight
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      const clientIp = req.headers.get("CF-Connecting-IP") || "127.0.0.1";

      // 2. IP Rate Limiting (Cloudflare Worker native rate limit)
      if (env.RATE_LIMITER) {
        try {
          const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
          if (!success) {
            return bad("Rate limit exceeded. Please try again later.", 429);
          }
        } catch (err) {
          console.error("Rate limiter error:", err);
        }
      }

      // 3. ADMIN ONLY: GET /reports — List recent reports (Requires ADMIN_API_KEY)
      if (method === "GET" && url.pathname === "/reports") {
        const adminKey = req.headers.get("X-Admin-Key") || req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!env.ADMIN_API_KEY || adminKey !== env.ADMIN_API_KEY) {
          return bad("Forbidden: Admin authentication required", 403);
        }

        const { results } = await env.DB.prepare(
          "SELECT id, created, series, chapter, page, bboxes, image_url, client_ip FROM reports ORDER BY created DESC LIMIT 100",
        ).all();
        return json(results);
      }

      // 4. ADMIN ONLY: GET /reports/:id — Retrieve single report
      if (method === "GET" && url.pathname.startsWith("/reports/")) {
        const adminKey = req.headers.get("X-Admin-Key") || req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!env.ADMIN_API_KEY || adminKey !== env.ADMIN_API_KEY) {
          return bad("Forbidden: Admin authentication required", 403);
        }

        const id = url.pathname.slice("/reports/".length);
        const row = await env.DB.prepare(
          "SELECT * FROM reports WHERE id = ?",
        ).bind(id).first();

        if (!row) return bad("Not found", 404);
        return json(row);
      }

      // 5. PUBLIC INGEST: POST — Accept anonymous report
      if (method === "POST") {
        // Check optional client ingest key
        if (env.CLIENT_INGEST_KEY) {
          const auth = req.headers.get("Authorization");
          if (!auth || auth !== `Bearer ${env.CLIENT_INGEST_KEY}`) {
            return bad("Unauthorized client", 401);
          }
        }

        // Check content-length guard
        const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_PAYLOAD_BYTES) {
          return bad(`Payload too large (max ${MAX_PAYLOAD_BYTES / 1024}KB)`, 413);
        }

        let rawBody: unknown;
        try {
          rawBody = await req.json();
        } catch {
          return bad("Invalid JSON body", 400);
        }

        // Strict validation
        const validation = validateReport(rawBody);
        if (!validation.valid) {
          return bad(validation.error, 400);
        }

        const report = validation.data;
        const id = crypto.randomUUID();

        // Store report in D1
        await env.DB.prepare(`
          INSERT INTO reports (id, series, chapter, page, bboxes, image_url, client_ip)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          report.seriesName,
          report.chapterId,
          report.pageIndex,
          JSON.stringify(report.bboxes),
          report.imageUrl,
          clientIp,
        ).run();

        return json({ success: true, id }, 201);
      }

      return bad(`Not found: ${method} ${url.pathname}`, 404);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal Server Error";
      console.error("Worker error:", err);
      return bad(message, 500);
    }
  },
};
