-- Migration: Create sessions table for multi-session management
-- Up

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT NULL,
    session_id TEXT NOT NULL UNIQUE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active_at ON sessions(last_active_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions(revoked_at);

-- Down (for rollback)
-- DROP TABLE IF EXISTS sessions;
