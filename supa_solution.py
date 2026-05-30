# Dynamic CORS Middleware Implementation

## Introduction

This bounty requires implementing dynamic CORS origin validation with callback support in FastAPI. The current middleware does not provide this functionality.

## Solution Overview

We will create a new `DynamicCORSMiddleware` class in the existing FastAPI source code that accepts an `allow_origin_func` callback. This callback will be responsible for dynamically allowing or denying origins based on the incoming request.

## Implementation

### DynamicCORSMiddleware Class
```python
# fastapi/fastapi/middleware/cors.py

from starlette.responses import Response
from starlette.http import HTTPStatus
from fastapi.middleware.cors import CORSMiddleware
import asyncio

class DynamicCORSMiddleware(CORSMiddleware):
    def __init__(self, allow_origin_func=None, cors_max_age=3600, **origins_kwargs):
        self.allow_origin_func = allow_origin_func
        super().__init__(**origins_kwargs)

    async def __call__(self, request, call_next):
        if self.allow_origin_func is None:
            # Fall back to static allow_origins list
            origins = [origin.value for origin in self.allowed_origins]
        else:
            origins = []

        for origin in await self.allow_origin_func(request.headers.get("Origin", "")):
            origins.append(origin)

        allowed_origins = set(origins)
        return super().__call__(request, call_next,
                                allowed_origins=allowed_origins,
                                allow_credentials=True,
                                expose_headers=self.expose_headers,
                                max_age=self(cors_max_age))
```

### Explanation

The `DynamicCORSMiddleware` class inherits from the existing `CORSMiddleware` and adds an `allow_origin_func` parameter. This callback is responsible for dynamically allowing or denying origins.

When `allow_origin_func` is not provided, it falls back to the static `allow_origins` list. When it is provided, the callback receives the origin string and returns True/False to determine whether to allow or deny the origin.

The `cors_max_age` parameter is added to configure the Access-Control-Max-Age header value.

## Example Usage
```python
from fastapi import FastAPI
from fastapi.middleware.cors import DynamicCORSMiddleware

app = FastAPI()

def dynamic_allow_origin_func(origin):
    # Example callback function that allows all origins
    return True

# Create a middleware instance with the dynamic allow origin function
origins_kwargs = {
    "allow_origin": dynamic_allow_origin_func,
}
middleware = DynamicCORSMiddleware(
    allow_origin=dynamic_allow_origin_func, cors_max_age=3600
)

@app.middleware("http")
async def middleware_fn(request, call_next):
    # Apply the middleware to each request
    return await middleware(request, call_next)
```

## Commit Message

"Added dynamic CORS origin validation with callback support in FastAPI"

Note: This solution assumes that the `fastapi` and `starlette` dependencies are already installed. If not, you can install them using pip:

```bash
pip install fastapi starlette
```