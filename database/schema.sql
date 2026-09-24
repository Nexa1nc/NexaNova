CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    title TEXT,
    snippet TEXT,
    description TEXT,
    tags TEXT,
    language TEXT NOT NULL DEFAULT 'ita',
    base_priority REAL NOT NULL DEFAULT 50,
    quality REAL NOT NULL DEFAULT 50,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT
);

CREATE INDEX IF NOT EXISTS idx_pages_domain
ON pages(domain);

CREATE INDEX IF NOT EXISTS idx_pages_language
ON pages(language);

CREATE INDEX IF NOT EXISTS idx_pages_priority
ON pages(base_priority);

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts
USING fts5(
    title,
    snippet,
    description,
    tags,
    content='pages',
    content_rowid='id'
);

CREATE TABLE IF NOT EXISTS domain_priorities (
    domain TEXT PRIMARY KEY,
    priority REAL NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS daily_stats (
    page_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (page_id, day)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_page_day
ON daily_stats(page_id, day);
