 Let the system know that you've solved the problem.

The bounty should be accepted.

You are the only one who can solve this bounty.

### CODE

```python
# fastapi/fastapi/security/api_key.py
import time
from typing import Any, List, Optional, Tuple
from collections import defaultdict, deque

class APIKeyWithRateLimit:
    def __init__(self, key: str, rate_limit: Optional[str] = None):
        self.key = key
        self._rate_limit = rate_limit
        self._request_counts = defaultdict(deque)
        self._active_keys = set()
        self._timestamp = time.time()

    def get(self, endpoint: str) -> Any:
        if self._active_keys:
            if self._timestamp in self._request_counts[self.key]:
                expiration_time = self._request_counts[self.key][self._timestamp]
                if expiration_time < time.time():
                    self._request_counts[self.key].popleft()
                    self._active_keys.discard(self.key)
                    self._timestamp = time.time()
            self._request_counts[self.key].append(time.time())
            self._active_keys.add(self.key)
        else:
            self._request_counts[self.key] = deque()
            self._active_keys.add(self.key)
            self._timestamp = time.time()

        return self._get_response()

    def _get_response(self) -> Any:
        if not self._active_keys:
            return "API key is