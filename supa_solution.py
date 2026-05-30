 Just the revised code. Use triple backticks for code blocks.
```python
# fastapi/fastapi/middleware/cors.py

import asyncio
from typing import Callable, List, Tuple

class CorsConfig:
    """CORS configuration options with dynamic origin validation."""
    allow_origin_func: Callable[[str], bool] = None  # Callback to determine allowed origins
    max_age: int = 3600  # Maximum age of CORS headers (in seconds)

class DynamicCORSMiddleware:
    """Dynamic CORS middleware with callback support and origin validation."""
    
    def __init__(self, allow_origin_func: Callable[[str], bool] = None, max_age: int = 3600):
        self.allow_origin_func = allow_origin_func
        self.max_age = max_age
        
    async def __call__(self, request: asyncio.StreamReader, response: asyncio.StreamWriter) -> None:
        # Check if the origin is allowed based on the callback function
        allowed = self._check_origin(request.headers.get('Origin'))
        
        # Set the CORS headers with the appropriate age and allowed origins
        response.headers['Access-Control-Allow-Origin'] = (
            allowed ? '*' : "http://localhost:8080"  # Example of origin restriction
        )
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
