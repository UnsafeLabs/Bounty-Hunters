"""
OAuth2 Password Bearer with Token Refresh support.

Extends FastAPI's OAuth2PasswordBearer to support the refresh_token grant type,
allowing clients to obtain new access tokens without re-authentication.
"""

from fastapi import status
from fastapi.exceptions import HTTPException
from fastapi.security.oauth2 import OAuth2PasswordBearer
from fastapi.security.oauth2 import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from typing import Optional


class OAuth2RefreshRequestForm(BaseModel):
    """
    Request form for OAuth2 token refresh.
    Similar to OAuth2PasswordRequestForm but accepts grant_type=refresh_token
    and a refresh_token field instead of username/password.
    """
    grant_type: str = Field(default="refresh_token", pattern="^refresh_token$")
    refresh_token: str
    scope: str = ""
    client_id: Optional[str] = None
    client_secret: Optional[str] = None

    class Config:
        extra = "forbid"


class OAuth2PasswordBearerWithRefresh(OAuth2PasswordBearer):
    """
    OAuth2 password bearer flow with token refresh support.
    
    Extends OAuth2PasswordBearer to accept an additional refresh_url
    parameter for the token refresh endpoint. The refresh flow allows
    clients to exchange a valid refresh_token for a new access_token
    without requiring username/password re-entry.
    """

    def __init__(
        self,
        tokenUrl: str,
        refreshUrl: Optional[str] = None,
        scheme_name: Optional[str] = None,
        scopes: Optional[dict] = None,
        description: Optional[str] = None,
        auto_error: bool = True,
    ):
        super().__init__(
            tokenUrl=tokenUrl,
            scheme_name=scheme_name,
            scopes=scopes,
            description=description,
            auto_error=auto_error,
        )
        self.refresh_url = refresh_url or tokenUrl


def create_token_response(
    access_token: str,
    refresh_token: str,
    token_type: str = "bearer",
    expires_in: Optional[int] = None,
    scope: Optional[str] = None,
) -> dict:
    """
    Helper to create a standard OAuth2 token response with refresh_token.
    
    Returns a dict matching the OAuth2 token endpoint response format:
    https://datatracker.ietf.org/doc/html/rfc6749#section-5.1
    """
    response = {
        "access_token": access_token,
        "token_type": token_type,
        "refresh_token": refresh_token,
    }
    if expires_in is not None:
        response["expires_in"] = expires_in
    if scope is not None:
        response["scope"] = scope
    return response


async def validate_refresh_token(
    refresh_token: str,
    token_url: str = "/token",
) -> dict:
    """
    Validate a refresh token and return its payload.
    
    This is a framework function — implementers should override or wrap
    this with their own JWT/validation logic.
    
    Raises HTTPException 401 if the refresh token is invalid or expired.
    """
    # Placeholder: actual validation should decode the JWT and check expiry
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )
