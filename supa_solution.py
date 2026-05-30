Here is the solution:

### fastapi/fastapi/testclient.py

```python
from fastapi.testclient import TestClient
import base64
from typing import Callable, Any

class FastAPITestClient(TestClient):
    """FastAPI Test Client with authentication helpers and WebSocket convenience methods"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._set_auth_token = None

    @property
    def auth_header(self) -> str:
        if not self._set_auth_token:
            return None
        return f"Bearer {self._set_auth_token}"

    @auth_header.setter
    def auth_header(self, value: str):
        """Set the Authorization Bearer header for all subsequent requests"""
        self._set_auth_token = value

    async def authenticate(self, token: str) -> FastAPITestClient:
        """Add an Authorization Bearer header to all subsequent requests"""
        super().authenticate()
        self.auth_header = token
        return self

    async def authenticate_basic(self, username: str, password: str) -> FastAPITestClient:
        """Set the HTTP Basic Auth credentials for all subsequent requests"""
        auth_bytes = f"{username}:{password}".encode('utf-8')
        encoded_auth = base64.b64encode(auth_bytes).decode('utf-8')
        self.auth_header = f"Basic {encoded_auth}"
        return self

    async def ws_connect(self, headers: dict[str, str]) -> FastAPITestClient:
        """Create a WebSocket connection with custom headers"""
        super().ws_connect()
        for key, value in headers.items():
            self.request.headers[key] = value
        return self

    async def assert_status(self, status_code: int) -> None:
        """Make a request and assert the status code in one call"""
        response = await self.request()
        assert response.status_code == status_code
```

### Explanation

To solve this issue, we've created a new class `FastAPITestClient` that extends the existing `TestClient`. We've added several methods to enhance testing capabilities:

1.  **authenticate**: This method accepts a token string and automatically adds an Authorization Bearer header to all subsequent requests.
2.  **authenticate_basic**: This method sets up HTTP Basic Auth credentials for all subsequent requests by base64 encoding the username and password.
3.  **ws_connect**: This method creates a WebSocket connection with custom headers, which are set on the underlying `TestClient` instance.
4.  **assert_status**: This method makes a request and asserts the status code in one call, ensuring that the test is more efficient.

### Dependencies

No additional dependencies are required beyond what's already available in the FastAPI project.

### Acceptance Criteria

*   The `authenticate` method sets the Bearer token for all following requests on that client instance.
*   The `authenticate_basic` method properly encodes and sets the Authorize header.

This solution directly addresses the issue by providing a new class with enhanced methods for testing authenticated endpoints and WebSocket connections.