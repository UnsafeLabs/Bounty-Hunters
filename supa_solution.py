 The solution should be self-contained.

---

```python
# t3code/apps/server/src/orchestration/checkpoint.py
# This file implements checkpoint snapshot pruning with retention policy and CLI command

import time
from functools import lru_cache
import asyncio
from datetime import datetime, timedelta
import sqlite3

# Constants
DEFAULT_RETENTION_DAYS = 7
DEFAULT_SESSION_SIZE = 100
DEFAULT_PRUNING_INTERVAL = 3600  # 1 hour

# SQLite connection
def connect_db():
    """Connect to the database."""
    conn = sqlite3.connect('t3code.db')
    return conn

def close_db(conn):
    """Close the database connection."""
    conn.close()

def create_db():
    """Create the database if it doesn't exist."""
    conn = connect_db()
    try:
        conn.execute('CREATE TABLE checkpoints (id INTEGER PRIMARY KEY, snapshot TEXT, timestamp TIMESTAMP)')
        conn.commit()
    except Exception as e:
        print(f"Error creating database: {e}")
        close_db(conn)

def delete_snapshot(snapshot_id, retention_days=DEFAULT_RETENTION_DAYS):
    """Remove snapshots older than retention period."""
    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute(f"DELETE FROM checkpoints WHERE timestamp < datetime('now', '-{retention_days} days') AND id = {snapshot_id}")
    conn.commit()

def prune_snapshots():
    """Run pruning automatically on schedule."""
    interval