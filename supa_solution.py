**FastAPI Test Client Implementation**
=====================================

### FastAPITestClient Class

```python
# fastapi/fastapi/testclient.py

from starlette.testclient import TestClient
import base64
from typing import Optional

class FastAPITestClient(TestClient):
    """
    A test client that provides additional helpers for testing authenticated endpoints and WebSocket connections.
    """

    def __init__(self, app: object, *args, **kwargs) -> None:
        super().__init__(app, *args, **kwargs)
        self.auth_token = None

    async def authenticate(self, token: str) -> FastAPITestClient:
        """
        Sets the Bearer token for all following requests on this client instance.

        Args:
            token (str): The authentication token.
        """
        if not token:
            raise ValueError("Token cannot be empty")
        self.auth_token = token
        return self

    async def authenticate_basic(self, username: str, password: str) -> FastAPITestClient:
        """
        Sets the HTTP Basic auth credentials for all following requests on this client instance.

        Args:
            username (str): The username.
            password (str): The password.

        Returns:
            FastAPITestClient: The authenticated test client.
        """
        if not username or not password:
            raise ValueError("Username and password cannot be empty")
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        self.auth_token = f"Basic {credentials}"
        return self
```

### WebSocket Convenience Methods

```python
    async def ws_connect(self, url: str, headers: Optional[dict] = None) -> 'WebSocketResponse':
        """
        Creates a WebSocket connection with custom headers.

        Args:
            url (str): The URL of the WebSocket endpoint.
            headers (Optional[dict]): Custom headers for the WebSocket request. Defaults to None.

        Returns:
            ContextManager: A context manager that yields a WebSocket response object.
        """
        if headers is None:
            headers = {}
        return self.connect(url=url, data=None, headers=headers)
```

### Assert Status Method

```python
    async def assert_status(self, status_code: int) -> FastAPITestClient:
        """
        Makes a request and asserts the status code in one call.

        Args:
            status_code (int): The expected status code.

        Returns:
            FastAPITestClient: The authenticated test client.
        """
        async with self.request(**{"status": status_code}) as response:
            assert response.status == status_code
        return self
```

### Example Usage

```python
from fastapi.testclient import FastAPITestClient

app = ...

client = FastAPITestClient(app)

# Authenticate with a token
async def test_authenticated_endpoint():
    client = await client.authenticate("my_token")
    response = await client.get("/protected-endpoint")
    assert response.status == 200

# Authenticate with basic auth
async def test_basic_authenticate():
    async def authenticate():
        return await client.authenticate_basic("username", "password")

    async def test_endpoints():
        async with authenticate() as authenticated_client:
            response = await authenticated_client.get("/basic-protected-endpoint")
            assert response.status == 200

# WebSocket connection
async def test_websocket_connection():
    async def connect():
        return await client.ws_connect("ws://example.com/ws")

    async def test_message():
        async with connect() as ws:
            await ws.send_text("Hello, server!")
            message = await ws.receive()
            assert message.text == "Hello, client!"

# Assert status code
async def test_assert_status_code():
    async def authenticate():
        return await client.authenticate("my_token")

    async def test_status_code():
        async with authenticate() as authenticated_client:
            response = await authenticated_client.get("/test-endpoint")
            assert response.status == 200

```

### Requirements and Setup

To run this code, you will need to install FastAPI and Starlette using pip:

```bash
pip install fastapi starlette
```

You can then use the `FastAPITestClient` class in your tests as shown in the example usage section.