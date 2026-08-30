# LMT Mock Server

Local replacement for the Supabase anonymous-reporting backend. Accepts the
same POST payload the extension sends and stores it in a SQLite in-memory DB.

## Requirements

- [Bun](https://bun.sh) 1.1+

## Usage

```bash
cd mock-server
bun run server.ts
```

By default it listens on **port 3001**. Override with `PORT`:

```bash
PORT=8080 bun run server.ts
```

## Extension Config

Set these in `lmt-1.0.0-alpha/.env` so the extension sends data here:

```
WXT_SUPABASE_URL=http://localhost:3001/rest/v1/bbox_data
WXT_SUPABASE_PUBLIC_KEY=any-string-you-like
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `*` | Accepts the anonymous-report payload. Stored in SQLite. |
| `GET` | `/reports` | List all stored reports (newest first). |
| `GET` | `/reports/:id` | Single report by UUID. |

## Payload Format (POST)

```json
{
  "seriesName": "One Piece",
  "chapterId": "1100",
  "pageIndex": 5,
  "bboxes": [{ "x1": 10, "y1": 20, "x2": 100, "y2": 80, "confidence": 0.95 }],
  "imageBase64": "data:image/jpeg;base64,..."
}
```

## Example

```bash
# Start server
bun run server.ts

# List reports (empty)
curl http://localhost:3001/reports

# Send a report (POST to any path)
curl -X POST http://localhost:3001/rest/v1/bbox_data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mock-key" \
  -d '{"seriesName":"Test","chapterId":"1","pageIndex":0,"bboxes":[],"imageBase64":""}'

# List reports (now has 1 entry)
curl http://localhost:3001/reports
```