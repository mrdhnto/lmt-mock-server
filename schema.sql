CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  created     TEXT NOT NULL DEFAULT (datetime('now')),
  series      TEXT NOT NULL,
  chapter     TEXT NOT NULL,
  page        INTEGER NOT NULL,
  bboxes      TEXT NOT NULL,          -- JSON string of bboxes
  image_url   TEXT NOT NULL,          -- Image source URL or page URL
  client_ip   TEXT                    -- IP for rate limiting / abuse tracking
);

CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created DESC);
CREATE INDEX IF NOT EXISTS idx_reports_series ON reports(series);
