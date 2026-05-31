```python
# t3code/apps/server/src/orchestration/checkpoint.py
import time
from functools import lru_cache
import asyncio
from datetime import datetime, timedelta
import sqlite3
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CheckpointStore:
    def __init__(self, retention_days=7):
        self.retention_days = retention_days
        self.checkpoints = {}
        self.lock = asyncio.Lock()

    async def create_db(self):
        """Create the database if it doesn't exist."""
        conn = sqlite3.connect('t3code.db')
        try:
            await self._create_table(conn)
            conn.commit()
        except Exception as e:
            logger.error(f"Error creating database: {e}")
            raise

    async def _create_table(self, conn):
        cursor = await conn.execute(
            'CREATE TABLE IF NOT EXISTS checkpoints (id INTEGER PRIMARY KEY, snapshot TEXT, timestamp TIMESTAMP, '
            'retention_policy TEXT)')

    async def insert_checkpoint(self, checkpoint_id, snapshot, timestamp, retention_policy=None):
        """Insert a new checkpoint into the database."""
        if retention_policy is None:
            retention_policy = self.retention_days
        await self.lock.acquire()
        try:
            self.checkpoints[checkpoint_id] = {'snapshot': snapshot, 'timestamp': timestamp, 'retention_policy': retention_policy}
            await self._update_table(conn=self.get_conn(), query='INSERT INTO checkpoints VALUES (?, ?, ?, ?)')
        finally:
            self.lock.release()

    async def delete_snapshot(self, checkpoint_id):
        """Delete a snapshot from the database."""
        if not checkpoint_id in self.checkpoints:
            logger.warning(f"No checkpoint found for ID {checkpoint_id}")
            return
        await self._update_table(conn=self.get_conn(), query='DELETE FROM checkpoints WHERE id=?', params=(checkpoint_id,))
        del self.checkpoints[checkpoint_id]

    async def prune_snapshots(self):
        """Run pruning automatically on schedule."""
        retention_days = self.retention_days
        interval = DEFAULT_PRUNING_INTERVAL  # 1 hour
        while True:
            await asyncio.sleep(interval)
            now = datetime.now()
            current_timestamps = [t['timestamp'] for t in self.checkpoints.values() if t['timestamp'] > now - timedelta(days=retention_days)]
            timestamps_to_prune = [t['timestamp'] for t in current_timestamps]
            await self._update_table(conn=self.get_conn(), query='UPDATE checkpoints SET timestamp=? WHERE id IN ?', params=(now, tuple(timestamps_to_prune)))
            deleted_ids = [t[0] for t in current_timestamps if t['timestamp'] not in timestamps_to_prune]
            logger.info(f"Deleted snapshots with IDs: {deleted_ids}")

    async def get_conn(self):
        """Return a connection to the database."""
        return sqlite3.connect('t3code.db')

class PruningService:
    def __init__(self, store):
        self.store = store
        self.prune_interval = DEFAULT_PRUNING_INTERVAL  # 1 hour

    async def schedule_pruning(self):
        """Schedule pruning to run every 'prune_interval' seconds."""
        loop = asyncio.get_running_loop()
        return await loop.create_task(self._schedule_pruning())

    async def _schedule_pruning(self):
        self.prune_service = PruneService(self.store)
        while True:
            await self.prune_service.schedule_pruning()

def main():
    retention_days = 7
    pruning_interval = 3600  # 1 hour

    store = CheckpointStore(retention_days=retention_days)
    service = PruningService(store)

    async def start_pruning():
        try:
            await service.schedule_pruning()
        except Exception as e:
            logger.error(f"Error starting pruning: {e}")

    import uvicorn
    if __name__ == "__main__":
        uvicorn.run(main, host="0.0.0.0", port=8000)

def cli():
    import argparse

    parser = argparse.ArgumentParser(description='Pruning Service')
    parser.add_argument('--prune-interval', type=int, default=3600)  # 1 hour
    args = parser.parse_args()

    retention_days = 7
    pruning_interval = args.prune_interval
    store = CheckpointStore(retention_days=retention_days)
    service = PruningService(store)

    async def start_pruning():
        try:
            await service.schedule_pruning()
        except Exception as e:
            logger.error(f"Error starting pruning: {e}")

    import uvicorn
    if __name__ == "__main__":
        uvicorn.run(main, host="0.0.0.0", port=8000)

if __name__ == '__main__':
    cli()

```