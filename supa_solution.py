 Only the final solution. Keep the same format as the original.
Answer:

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import asyncio
import time
from typing import Optional
from contextlib import contextmanager

app = FastAPI()

# Create a simple in-memory counter for brute force protection
_brute_force_counter = {}

@contextmanager
def timer(name: str) -> None:
    """Context manager to measure the execution time of a block."""
    start_time = time.time()
    try:
        yield
    finally:
        end_time = time.time()
        print(f"{name} took {end_time - start_time:.2f} seconds")

class HTTPBasicWithProtection(HTTPBasic):
    def __init__(self, max_attempts: int) -> None:
        super().__init__()
        self._max_attempts = max_attempts
        self._brute_force_counter = {}

    def authenticate(self, request: Request) -> Optional[HTTPBasicCredentials]:
        """Authenticate the user with brute force protection."""
        try:
            credentials = await super().authenticate(request)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=429, detail="Too many attempts", headers={"Retry-After": "1"},)

        if self._brute_force_counter.get(credentials.username, 0) < 60:
            raise HTTPException(
                status