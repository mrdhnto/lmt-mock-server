# LMT Telemetry Server (Cloudflare Worker + D1)

Production backend for LMT anonymous-report telemetry. Drop-in replacement for Supabase.

## Architecture & Protections

- **Edge DDoS & Rate Limiting:** Cloudflare native rate limiter restricts excessive requests per IP (15 req/min).
- **Size & Payload Guard:** Hard cap at 100KB payload, strict schema validation for bboxes coordinates, string lengths, and URL bounds.
- **Serverless D1 Storage:** All report metadata and image URLs indexed directly in Cloudflare D1 SQLite.
- **Admin Authentication:** `GET /reports` and `GET /reports/:id` are protected by `ADMIN_API_KEY`. Public clients can only `POST`.
- **Client Key:** `POST` ingestion requires `CLIENT_INGEST_KEY` (`Authorization: Bearer ...`).

---

## Setup & Cloudflare Provisioning

### 1. Install Dependencies
```bash
cd mock-server
bun install
```

### 2. Provision Cloudflare Resources

```bash
# Login to Cloudflare
npx wrangler login

# Create D1 Database (copy returned database_id to wrangler.jsonc)
npx wrangler d1 create lmt-reports
```

### 3. Set Secrets
```bash
# Set your private Admin Key (for viewing/exporting reports)
npx wrangler secret put ADMIN_API_KEY
```

### 4. Initialize Database Schema
```bash
# Run on local preview DB:
bun run d1:local

# Run on Cloudflare production D1:
bun run d1:remote
```

### 5. Deploy
```bash
bun run deploy
```

---

## Extension Configuration

In `lmt-1.0.0-alpha/.env`:

```env
WXT_TELEMETRY_URL=https://lmt-report-server.<your-subdomain>.workers.dev/rest/v1/bbox_data
WXT_TELEMETRY_PUBLIC_KEY=lmt-public-telemetry-key
```

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `*` | Bearer Client Key | Ingest anonymous report (`seriesName`, `chapterId`, `pageIndex`, `bboxes`, `imageUrl`). |
| `GET` | `/reports` | `X-Admin-Key` | List 100 recent reports. |
| `GET` | `/reports/:id` | `X-Admin-Key` | Get complete report by UUID. |
| `OPTIONS`| `*` | None | CORS preflight. |
