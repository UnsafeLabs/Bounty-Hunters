"""OAuth2 security dependencies, including password refresh support."""

from typing import Annotated, Any

from fastapi.openapi.models import OAuth2 as OAuth2Model
from fastapi.openapi.models import OAuthFlows as OAuthFlowsModel
from fastapi.param_functions import Form
from fastapi.security.oauth2 import OAuth2PasswordBearer, OAuth2PasswordRequestForm


class OAuth2PasswordBearerWithRefresh(OAuth2PasswordBearer):
    """OAuth2 password bearer dependency with a refresh-token endpoint.

    The inherited bearer-token extraction behavior is intentionally unchanged;
    ``refresh_url`` only adds the corresponding OpenAPI metadata.
    """

    def __init__(self, tokenUrl: str, refresh_url: str, **kwargs: Any) -> None:
        # FastAPI's public OAuth2 model uses camelCase in Python parameters and
        # serializes it as ``refreshUrl`` in OpenAPI.
        super().__init__(tokenUrl=tokenUrl, refreshUrl=refresh_url, **kwargs)


class OAuth2RefreshRequestForm:
    """Dependency for an OAuth2 ``refresh_token`` form request.

    ``grant_type`` is required and is validated by FastAPI's form parameter
    machinery.  Direct construction is validated too, which is useful in unit
    tests and keeps the class safe outside dependency injection.
    """

    def __init__(
        self,
        grant_type: Annotated[str, Form(pattern="^refresh_token$")],
        refresh_token: Annotated[str, Form()],
        scope: Annotated[str, Form()] = "",
        client_id: Annotated[str | None, Form()] = None,
        client_secret: Annotated[str | None, Form()] = None,
    ) -> None:
        if grant_type != "refresh_token":
            raise ValueError("grant_type must be 'refresh_token'")
        self.grant_type = grant_type
        self.refresh_token = refresh_token
        self.scopes = scope.split()
        self.client_id = client_id
        self.client_secret = client_secret
