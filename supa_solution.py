 Only the new code.
```python
```python
# fastapi/fastapi/middleware/cors.py

from starlette import Response
from starlette.requests import Request
from starlette import exceptions
from fastapi import Depends, FastAPI
import asyncio

class DynamicCORSMiddleware(CORSMiddleware):
    def __init__(self, allow_origin_func=None, **origins_kwargs):
        self.allow_origin_func = allow_origin_func
        super().__init__(**origins_kwargs)

    async def __call__(self, request: Request, call_next):
        # Check if we have a callback function to apply
        if self.allow_origin_func is None:
            # Fall back to static allow_origins list
            origins = [origin.value for origin in self.allowed_origins]
        else:
            origins = []

        # Create a list of allowed origins based on the callback
        allowed_origins = []
        for origin in await self.allow_origin_func(request.headers.get("Origin", "")):
            allowed_origins.append(origin)

        # Apply the middleware
        return Response(
            f"Allowed origins: {allowed_origins}",
            status_code=HTTPStatus.OK,
            headers={"Access-Control-Allow-Origin": "origin"}
        )
`````````````````````````````````````````````````````````````````````````````````````````````