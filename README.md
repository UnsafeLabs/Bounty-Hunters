from typing import Annotated

from annotated_doc import Doc
from fastapi.param_functions import Form


class OAuth2PasswordRequestForm:
    """
    This is a dependency class to collect the `username` and `password` as form data
    for an OAuth2 password flow.

    The OAuth2 specification dictates that for a password flow the data should be
    collected using form data (instead of JSON) and that it should have the specific
    fields `username` and `password`.

    All the initialization parameters are extracted from the request.

    Read more about it in the
    [FastAPI docs for Simple OAuth2 with Password and Bearer](https://fastapi.tiangolo.com/tutorial/security/simple-oauth2/).
    """

    def __init__(
        self,
        *,
        grant_type: Annotated[
            str | None,
            Form(pattern="^password$"),
            Doc(
                """
                The OAuth2 spec says it is required and MUST be the fixed string
                "password". Nevertheless, this dependency class is permissive and
                allows not passing it. If you want to enforce it, use instead the
                `OAuth2PasswordRequestFormStrict` dependency.
                """
            ),
        ] = None,
        username: Annotated[
            str, 
            Form(), 
            Doc("`username` string. The OAuth2 spec requires the exact field name `username`.")
        ],
        password: Annotated[
            str,
            Form(json_schema_extra={"format": "password"}),
            Doc("`password` string. The OAuth2 spec requires the exact field name `password`."),
        ],
        scope: Annotated[
            str,
            Form(),
            Doc("A single string with actually several scopes separated by spaces."),
        ] = "",
        client_id: Annotated[str | None, Form()] = None,
        client_secret: Annotated[str | None, Form(json_schema_extra={"format": "password"})] = None,
    ):
        self.grant_type = grant_type
        self.username = username
        self.password = password
        self.scopes = scope.split()
        self.client_id = client_id
        self.client_secret = client_secret


class OAuth2RefreshRequestForm:
    """
    Dependency class to collect `refresh_token` as form data for OAuth2 refresh flow.
    """

    def __init__(
        self,
        *,
        grant_type: Annotated[str, Form(pattern="^refresh_token$")],
        refresh_token: Annotated[str, Form()],
        scope: Annotated[str, Form()] = "",
    ):
        self.grant_type = grant_type
        self.refresh_token = refresh_token
        self.scopes = scope.split()


class OAuth2PasswordRequestFormStrict(OAuth2PasswordRequestForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.grant_type != "password":
            raise ValueError("grant_type must be 'password'")
