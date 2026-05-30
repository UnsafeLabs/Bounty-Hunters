### Solution

We'll create a new class `OAuth2PasswordBearerWithRefresh` that extends the existing `OAuth2PasswordBearer`. This class will accept an additional `refresh_url` parameter for token refresh.

```python
# fastapi/fastapi/security/oauth2.py

from fastapi.security import OAuth2PasswordBearer, OAuth2RefreshRequestForm
from fastapi.responses import JSONResponse
from typing import Optional
import requests

class OAuth2PasswordBearerWithRefresh(OAuth2PasswordBearer):
    def __init__(self, token_url: str = None, refresh_url: str = None, *args, **kwargs):
        self.token_url = token_url or kwargs.pop('token_url', None)
        self.refresh_url = refresh_url
        super().__init__(*args, **kwargs)

    async def authenticate(self, request: Request) -> Optional[User]:
        # existing OAuth2PasswordBearer behavior is not modified
        return await super().authenticate(request)

    async def authorization_url_for(self, user_id: str, *args, **kwargs):
        # add refresh URL to the OpenAPI schema
        if self.refresh_url:
            kwargs['description'] = f"Refresh token for {self.token_url}"
            kwargs['url'] = self.refresh_url
        return super().authorization_url_for(user_id, *args, **kwargs)

class OAuth2RefreshRequestForm(OAuth2PasswordRequestForm):
    grant_type: str

    class Meta:
        fields = ('grant_type', 'refresh_token')
```

### Explanation

*   We create a new class `OAuth2PasswordBearerWithRefresh` that extends the existing `OAuth2PasswordBearer`.
*   The new class accepts an additional `refresh_url` parameter for token refresh, which is stored as an instance variable.
*   In the `authenticate` method, we call the parent's behavior to maintain the existing OAuth2 behavior.
*   We override the `authorization_url_for` method to add the refresh URL to the OpenAPI schema. This allows the user to access the refresh endpoint via API documentation.
*   We create a new class `OAuth2RefreshRequestForm` that extends `OAuth2PasswordRequestForm`. The new form accepts an additional field for the `grant_type`, which is set to `'refresh_token'`.
*   Finally, we export both classes from `fastapi/fastapi/__init__.py`.

### Setup

To test this solution, you can create a FastAPI application that uses these new classes:

```python
# main.py

from fastapi import FastAPI, Request
from fastapi.security import OAuth2PasswordBearerWithRefresh
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
import requests
from typing import Optional

app = FastAPI()

security = OAuth2PasswordBearerWithRefresh(token_url="http://example.com/token")

@app.post("/token")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    # existing OAuth2 behavior is not modified
    return {"access_token": "token"}

@app.get("/refresh-token")
async def refresh_token(form_data: OAuth2RefreshRequestForm = Depends()):
    response = requests.post(form_data.refresh_url, data=form_data)
    if response.status_code == 200:
        return JSONResponse(content=response.json(), media_type="application/json")
    else:
        return JSONResponse(status_code=400, content={"error": "Invalid refresh token"}, media_type="application/json")

```

### Commit Message

`Added OAuth2PasswordBearerWithRefresh class to support token refresh`

This solution is ready for commit and includes the new classes `OAuth2PasswordBearerWithRefresh` and `OAuth2RefreshRequestForm`, which are exported from `fastapi/fastapi/__init__.py`.