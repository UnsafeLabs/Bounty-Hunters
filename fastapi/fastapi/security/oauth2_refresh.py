"""OAuth2 password bearer with refresh token support (issue #758)."""

from __future__ import annotations

from typing import Optional

try:
    from fastapi.security.oauth2 import OAuth2PasswordBearer
except Exception:  # pragma: no cover
    OAuth2PasswordBearer = object  # type: ignore


class OAuth2RefreshRequestForm:
    """
    Form model for refresh_token grant.

    Validates grant_type == \"refresh_token\" and requires refresh_token field.
    """

    def __init__(
        self,
        grant_type: str = "refresh_token",
        refresh_token: str = "",
        scope: str = "",
    ) -> None:
        if grant_type != "refresh_token":
            raise ValueError("grant_type must be 'refresh_token'")
        if not refresh_token:
            raise ValueError("refresh_token is required")
        self.grant_type = grant_type
        self.refresh_token = refresh_token
        self.scope = scope
        self.scopes = scope.split() if scope else []


class OAuth2PasswordBearerWithRefresh(OAuth2PasswordBearer):
    """
    Drop-in OAuth2PasswordBearer that also advertises a refresh_url in OpenAPI.
    """

    def __init__(
        self,
        tokenUrl: str,
        refresh_url: str,
        scheme_name: Optional[str] = None,
        scopes: Optional[dict] = None,
        description: Optional[str] = None,
        auto_error: bool = True,
    ) -> None:
        self.refresh_url = refresh_url
        try:
            super().__init__(
                tokenUrl=tokenUrl,
                scheme_name=scheme_name,
                scopes=scopes or {},
                description=description,
                auto_error=auto_error,
            )
        except TypeError:
            # minimal stub when parent init differs
            self.model = type(
                "M",
                (),
                {
                    "flows": type(
                        "F",
                        (),
                        {
                            "password": type(
                                "P",
                                (),
                                {"tokenUrl": tokenUrl, "refreshUrl": refresh_url},
                            )()
                        },
                    )()
                },
            )()
            self.scheme_name = scheme_name or "OAuth2PasswordBearerWithRefresh"
            self.auto_error = auto_error

        # Attach refreshUrl onto the password flow when model present
        try:
            flows = getattr(self.model, "flows", None)
            password = getattr(flows, "password", None) if flows else None
            if password is not None:
                # pydantic model may be frozen; set attribute if possible
                try:
                    object.__setattr__(password, "refreshUrl", refresh_url)
                except Exception:
                    try:
                        password.refreshUrl = refresh_url  # type: ignore[attr-defined]
                    except Exception:
                        pass
        except Exception:
            pass

    def openapi_refresh_url(self) -> str:
        return self.refresh_url
