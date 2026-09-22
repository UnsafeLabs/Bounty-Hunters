"""OAuth2 security utilities.

This module extends the standard FastAPI OAuth2 utilities to add support for
the token refresh flow. It introduces two new public classes:

* :class:`OAuth2PasswordBearerWithRefresh` – a drop‑in replacement for
  :class:`fastapi.security.OAuth2PasswordBearer` that also includes a
  ``refreshUrl`` in the generated OpenAPI schema.
* :class:`OAuth2RefreshRequestForm` – a request‑body model for the
  ``grant_type=refresh_token`` flow, mirroring the behaviour of
  :class:`fastapi.security.OAuth2PasswordRequestForm`.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import Form
from fastapi.security import OAuth2PasswordBearer
from fastapi.openapi.models import OAuthFlows as OAuthFlowsModel

__all__ = [
    "OAuth2PasswordBearerWithRefresh",
    "OAuth2RefreshRequestForm",
]


class OAuth2PasswordBearerWithRefresh(OAuth2PasswordBearer):
    """
    OAuth2 password flow with an additional ``refreshUrl`` for token refresh.

    This class behaves exactly like :class:`OAuth2PasswordBearer` but adds a
    ``refreshUrl`` field to the OpenAPI security scheme definition. The extra
    ``refresh_url`` argument is required and will be exposed in the generated
    OpenAPI schema under ``flows.password.refreshUrl``.
    """

    def __init__(
        self,
        tokenUrl: str,
        refresh_url: str,
        *,
        scheme_name: Optional[str] = None,
        scopes: Optional[dict] = None,
        auto_error: bool = True,
    ) -> None:
        """
        Parameters
        ----------
        tokenUrl: str
            URL where the client can obtain an access token.
        refresh_url: str
            URL where the client can obtain a new access token using a refresh token.
        scheme_name: Optional[str]
            Name of the security scheme in the OpenAPI schema.
        scopes: Optional[dict]
            Mapping of scope names to descriptions.
        auto_error: bool
            If ``True``, FastAPI will raise an HTTPException when the token is
            missing or invalid.
        """
        super().__init__(
            tokenUrl=tokenUrl,
            scheme_name=scheme_name,
            scopes=scopes,
            auto_error=auto_error,
        )
        self.refresh_url = refresh_url

        # ``self.model`` is an instance of ``OAuth2`` (a subclass of
        # ``SecurityBase``) that holds the OpenAPI model.  The password flow
        # lives under ``self.model.flows.password``.  We inject the refreshUrl
        # here so that the generated OpenAPI spec contains it.
        if (
            hasattr(self, "model")
            and self.model
            and isinstance(self.model.flows, OAuthFlowsModel)
            and self.model.flows.password is not None
        ):
            # The attribute is called ``refreshUrl`` in the OpenAPI spec.
            self.model.flows.password.refreshUrl = refresh_url  # type: ignore[attr-defined]


class OAuth2RefreshRequestForm:
    """
    Request form for the ``grant_type=refresh_token`` flow.

    Mirrors :class:`fastapi.security.OAuth2PasswordRequestForm` but validates
    that ``grant_type`` is exactly ``refresh_token`` and provides a
    ``refresh_token`` field instead of ``username``/``password``.
    """

    def __init__(
        self,
        grant_type: str = Form(..., regex="refresh_token"),
        refresh_token: str = Form(...),
        scope: str = Form(""),
        client_id: Optional[str] = Form(None),
        client_secret: Optional[str] = Form(None),
    ):
        """
        Parameters
        ----------
        grant_type: str
            Must be ``refresh_token`` – enforced by the ``regex`` argument.
        refresh_token: str
            The refresh token issued by the authorization server.
        scope: str
            Optional space‑separated list of scopes.
        client_id: Optional[str]
            Optional client identifier.
        client_secret: Optional[str]
            Optional client secret.
        """
        self.grant_type: str = grant_type
        self.refresh_token: str = refresh_token
        self.scopes: List[str] = scope.split()
        self.client_id: Optional[str] = client_id
        self.client_secret: Optional[str] = client_secret
