 Just the new implementation.
```
```
```python
```python
```python
from starlette.testclient import TestClient
import base64
import os

class FastAPITestClient(TestClient):
    """
    A test client that provides additional helpers for testing authenticated endpoints and WebSocket connections.
    """

    def __init__(self, app: object, *args, **kwargs) -> None:
        super().__init__(app, *args, **kwargs)
        self.auth_token = None

    async def authenticate(self, token: str) -> 'FastAPITestClient':
        """
        Sets the Bearer token for all following requests on this client instance.
        
        Args:
            token (str): The authentication token.
        """
        if not token:
            raise ValueError("Token cannot be empty")
        self.auth_token = token
        return self

    async def authenticate_basic(self, username: str, password: str) -> 'FastAPITestClient':
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
        self.auth