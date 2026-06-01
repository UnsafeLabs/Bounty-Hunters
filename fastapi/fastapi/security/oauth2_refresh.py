"""
OAuth2 with token refresh support for FastAPI.
Extends OAuth2PasswordBearer with refresh token flow.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from typing import Optional, Dict, Any
from pydantic import BaseModel
import time


class TokenResponse(BaseModel):
    """Standard token response with refresh token."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_expires_in: int


class TokenData(BaseModel):
    """Decoded token data."""
    sub: str
    exp: float
    type: str  # "access" or "refresh"


class OAuth2PasswordBearerWithRefresh(OAuth2PasswordBearer):
    """
    OAuth2 bearer with refresh token support.

    Usage:
        oauth2 = OAuth2PasswordBearerWithRefresh(
            token_url="/auth/token",
            refresh_url="/auth/refresh",
        )

        @app.get("/protected")
        async def protected(token: str = Depends(oauth2)):
            return {"token": token}
    """

    def __init__(
        self,
        tokenUrl: str,
        refreshUrl: str = "/auth/refresh",
        scheme_name: str = "OAuth2PasswordBearerWithRefresh",
        auto_error: bool = True,
        access_token_expire: int = 3600,
        refresh_token_expire: int = 604800,
    ):
        super().__init__(
            tokenUrl=tokenUrl,
            scheme_name=scheme_name,
            auto_error=auto_error,
        )
        self.refresh_url = refreshUrl
        self.access_token_expire = access_token_expire
        self.refresh_token_expire = refresh_token_expire

    async def __call__(self, request) -> Optional[str]:
        """Extract and validate access token."""
        token = await super().__call__(request)
        if token:
            # Validate token type is access
            token_data = self.decode_token(token)
            if token_data and token_data.get("type") == "refresh":
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Cannot use refresh token as access token",
                    headers={"WWW-Authenticate": "Bearer"},
                )
        return token

    def decode_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Decode and validate a JWT token. Override with your JWT library."""
        # Placeholder - implement with python-jose or PyJWT
        import base64
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return None
            payload = parts[1]
            # Add padding
            payload += "=" * (4 - len(payload) % 4)
            import json
            return json.loads(base64.urlsafe_b64decode(payload))
        except Exception:
            return None

    def create_token_pair(
        self,
        subject: str,
        access_claims: dict = None,
        refresh_claims: dict = None,
    ) -> TokenResponse:
        """Create access + refresh token pair. Override with your JWT library."""
        now = time.time()
        access_payload = {
            "sub": subject,
            "exp": now + self.access_token_expire,
            "type": "access",
            **(access_claims or {}),
        }
        refresh_payload = {
            "sub": subject,
            "exp": now + self.refresh_token_expire,
            "type": "refresh",
            **(refresh_claims or {}),
        }

        # Placeholder - encode with your JWT library
        import json
        import base64
        access_token = base64.urlsafe_b64encode(json.dumps(access_payload).encode()).decode()
        refresh_token = base64.urlsafe_b64encode(json.dumps(refresh_payload).encode()).decode()

        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=self.access_token_expire,
            refresh_expires_in=self.refresh_token_expire,
        )


def create_refresh_endpoint(
    oauth2: OAuth2PasswordBearerWithRefresh,
    verify_refresh_token: callable,
    get_user_claims: callable = None,
):
    """
    Factory to create a token refresh endpoint.

    Args:
        oauth2: OAuth2PasswordBearerWithRefresh instance
        verify_refresh_token: async function(refresh_token) -> user_id
        get_user_claims: async function(user_id) -> dict of additional claims

    Returns:
        FastAPI endpoint function
    """
    from fastapi import APIRouter

    router = APIRouter()

    @router.post(oauth2.refresh_url, response_model=TokenResponse)
    async def refresh_token(refresh_token: str):
        token_data = oauth2.decode_token(refresh_token)
        if not token_data or token_data.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token",
            )

        # Check expiration
        if token_data.get("exp", 0) < time.time():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token expired",
            )

        user_id = await verify_refresh_token(refresh_token)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token",
            )

        claims = {}
        if get_user_claims:
            claims = await get_user_claims(user_id)

        return oauth2.create_token_pair(
            subject=user_id,
            access_claims=claims,
        )

    return router
