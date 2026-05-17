import binascii
from base64 import b64decode
from collections import defaultdict
from typing import Annotated, Callable
import time
from threading import Lock

from annotated_doc import Doc
from fastapi.exceptions import HTTPException
from fastapi.openapi.models import HTTPBase as HTTPBaseModel
from fastapi.openapi.models import HTTPBearer as HTTPBearerModel
from fastapi.security.base import SecurityBase
from fastapi.security.utils import get_authorization_scheme_param
from pydantic import BaseModel
from starlette.requests import Request
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_429_TOO_MANY_REQUESTS


class HTTPBasicCredentials(BaseModel):
    """
    The HTTP Basic credentials given as the result of using `HTTPBasic` in a
    dependency.

    Read more about it in the
    [FastAPI docs for HTTP Basic Auth](https://fastapi.tiangolo.com/advanced/security/http-basic-auth/).
    """

    username: Annotated[str, Doc("The HTTP Basic username.")]
    password: Annotated[str, Doc("The HTTP Basic password.")]


class HTTPAuthorizationCredentials(BaseModel):
    """
    The HTTP authorization credentials in the result of using `HTTPBearer` or
    `HTTPDigest` in a dependency.

    The HTTP authorization header value is split by the first space.

    The first part is the `scheme`, the second part is the `credentials`.

    For example, in an HTTP Bearer token scheme, the client will send a header
    like:

    ```
    Authorization: Bearer deadbeef12346
    ```

    In this case:

    * `scheme` will have the value `"Bearer"`
    * `credentials` will have the value `"deadbeef12346"`
    """

    scheme: Annotated[
        str,
        Doc(
            """
            The HTTP authorization scheme extracted from the header value.
            """
        ),
    ]
    credentials: Annotated[
        str,
        Doc(
            """
            The HTTP authorization credentials extracted from the header value.
            """
        ),
    ]


class HTTPBase(SecurityBase):
    model: HTTPBaseModel

    def __init__(
        self,
        *,
        scheme: str,
        scheme_name: str | None = None,
        description: str | None = None,
        auto_error: bool = True,
    ):
        self.model = HTTPBaseModel(scheme=scheme, description=description)
        self.scheme_name = scheme_name or self.__class__.__name__
        self.auto_error = auto_error

    def make_authenticate_headers(self) -> dict[str, str]:
        return {"WWW-Authenticate": f"{self.model.scheme.title()}"}

    def make_not_authenticated_error(self) -> HTTPException:
        return HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers=self.make_authenticate_headers(),
        )

    async def __call__(self, request: Request) -> HTTPAuthorizationCredentials | None:
        authorization = request.headers.get("Authorization")
        scheme, credentials = get_authorization_scheme_param(authorization)
        if not (authorization and scheme and credentials):
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        return HTTPAuthorizationCredentials(scheme=scheme, credentials=credentials)


class HTTPBasic(HTTPBase):
    """
    HTTP Basic authentication.

    Ref: https://datatracker.ietf.org/doc/html/rfc7617

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be an `HTTPBasicCredentials` object containing the
    `username` and the `password`.

    Read more about it in the
    [FastAPI docs for HTTP Basic Auth](https://fastapi.tiangolo.com/advanced/security/http-basic-auth/).

    ## Example

    ```python
    from typing import Annotated

    from fastapi import Depends, FastAPI
    from fastapi.security import HTTPBasic, HTTPBasicCredentials

    app = FastAPI()

    security = HTTPBasic()


    @app.get("/users/me")
    def read_current_user(credentials: Annotated[HTTPBasicCredentials, Depends(security)]):
        return {"username": credentials.username, "password": credentials.password}
    ```
    """

    def __init__(
        self,
        *,
        scheme_name: Annotated[
            str | None,
            Doc(
                """
                Security scheme name.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        realm: Annotated[
            str | None,
            Doc(
                """
                HTTP Basic authentication realm.
                """
            ),
        ] = None,
        description: Annotated[
            str | None,
            Doc(
                """
                Security scheme description.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, if the HTTP Basic header is not provided, `HTTPBasic`
                will automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the HTTP Basic header is not
                available, instead of erroring out, the dependency result will be
                `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in an HTTP
                Bearer token or in a cookie).
                """
            ),
        ] = True,
    ):
        self.realm = realm
        super().__init__(
            scheme="basic",
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )

    async def __call__(  # type: ignore[override]
        self, request: Request
    ) -> HTTPBasicCredentials | None:
        authorization = request.headers.get("Authorization")
        scheme, param = get_authorization_scheme_param(authorization)
        if not (authorization and scheme and param):
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        if scheme.lower() != "basic":
            if self.auto_error:
                raise HTTPException(
                    status_code=HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication credentials",
                    headers=self.make_authenticate_headers(),
                )
            else:
                return None
        try:
            data = b64decode(param).decode("utf-8")
        except (ValueError, binascii.Error, UnicodeDecodeError):
            if self.auto_error:
                raise HTTPException(
                    status_code=HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication credentials",
                    headers=self.make_authenticate_headers(),
                )
            else:
                return None
        username, separator, password = data.partition(":")
        if not separator:
            if self.auto_error:
                raise HTTPException(
                    status_code=HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication credentials",
                    headers=self.make_authenticate_headers(),
                )
            else:
                return None
        return HTTPBasicCredentials(username=username, password=password)

    def make_authenticate_headers(self) -> dict[str, str]:
        if self.realm:
            return {"WWW-Authenticate": f'Basic realm="{self.realm}"'}
        return super().make_authenticate_headers()


class HTTPBasicWithProtection(HTTPBasic):
    """
    HTTP Basic authentication with brute force protection per IP.

    Extends `HTTPBasic` with:
    - Failed attempt tracking per connecting IP
    - Lockout after `max_attempts` failures within a configurable time window
    - Automatic `Retry-After` header on lockout (HTTP 429)
    - Password verification via a user-supplied callable
    - Static method for constant‑time password verification using bcrypt (via `passlib`)

    ## Usage

    ```python
    from fastapi.security import HTTPBasicWithProtection

    # Your password checking function
    def verify_user_password(username: str, password: str) -> bool:
        stored_hash = get_hash_for_user(username)
        return HTTPBasicWithProtection.verify_password(password, stored_hash)

    security = HTTPBasicWithProtection(
        verify_password=verify_user_password,
        max_attempts=5,
        lockout_duration_seconds=300,
    )
    ```
    """

    def __init__(
        self,
        *,
        verify_password: Callable[[str, str], bool],
        max_attempts: int = 5,
        lockout_duration_seconds: int = 300,
        **kwargs,
    ):
        super().__init__(**kwargs)
        if not callable(verify_password):
            raise TypeError("verify_password must be a callable")
        self.verify_password_func = verify_password
        self.max_attempts = max_attempts
        self.lockout_duration = lockout_duration_seconds
        self._attempts: dict[str, dict] = defaultdict(
            lambda: {"count": 0, "lockout_until": 0.0}
        )
        self._lock = Lock()

    @staticmethod
    def verify_password(
        password: str, hashed_password: str
    ) -> bool:
        """
        Verify a password against a bcrypt hash using constant‑time comparison.

        Requires the `passlib` library. If `passlib` is not installed, a
        `RuntimeError` is raised.
        """
        try:
            from passlib.hash import bcrypt
            return bcrypt.verify(password, hashed_password)
        except ImportError:
            raise RuntimeError(
                "passlib is required for bcrypt password verification. "
                "Install it with: pip install passlib[bcrypt]"
            )

    async def __call__(  # type: ignore[override]
        self, request: Request
    ) -> HTTPBasicCredentials | None:
        # First get the credentials using the parent logic
        credentials = await super().__call__(request)
        if credentials is None:
            return None

        client_ip = request.client.host if request.client else "unknown"
        now = time.time()

        with self._lock:
            entry = self._attempts[client_ip]
            if entry["lockout_until"] > now:
                retry_after = int(entry["lockout_until"] - now)
                raise HTTPException(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too Many Requests",
                    headers={"Retry-After": str(retry_after)},
                )

        # Verify the password
        if not self.verify_password_func(
            credentials.username, credentials.password
        ):
            with self._lock:
                entry = self._attempts[client_ip]
                entry["count"] += 1
                if entry["count"] >= self.max_attempts:
                    entry["lockout_until"] = now + self.lockout_duration
            raise HTTPException(
                status_code=HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers=self.make_authenticate_headers(),
            )

        # Successful authentication – reset counter
        with self._lock:
            self._attempts.pop(client_ip, None)

        return credentials


class HTTPBearer(HTTPBase):
    """
    HTTP Bearer authentication.

    Ref: https://datatracker.ietf.org/doc/html/rfc6750

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be an `HTTPAuthorizationCredentials` object containing
    the `scheme` and the `credentials`.

    Read more about it in the
    [FastAPI docs for HTTP Bearer Auth](https://fastapi.tiangolo.com/advanced/security/http-bearer-auth/).

    ## Example

    ```python
    from typing import Annotated

    from fastapi import Depends, FastAPI
    from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

    app = FastAPI()

    security = HTTPBearer()


    @app.get("/users/me")
    def read_current_user(
        credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)]
    ):
        return {"scheme": credentials.scheme, "credentials": credentials.credentials}
    ```
    """

    def __init__(
        self,
        *,
        bearerFormat: Annotated[
            str | None,
            Doc(
                """
                Bearer token format.
                """
            ),
        ] = None,
        scheme_name: Annotated[
            str | None,
            Doc(
                """
                Security scheme name.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        description: Annotated[
            str | None,
            Doc(
                """
                Security scheme description.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, if the HTTP Bearer header is not provided, `HTTPBearer`
                will automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the HTTP Bearer header is not
                available, instead of erroring out, the dependency result will be
                `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in an HTTP
                Bearer token or in a cookie).
                """
            ),
        ] = True,
    ):
        self.model = HTTPBearerModel(bearerFormat=bearerFormat, description=description)
        self.scheme_name = scheme_name or self.__class__.__name__
        self.auto_error = auto_error


class HTTPDigest(HTTPBase):
    """
    HTTP Digest authentication.

    Ref: https://datatracker.ietf.org/doc/html/rfc7616

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be an `HTTPAuthorizationCredentials` object containing
    the `scheme` and the `credentials`.

    Read more about it in the
    [FastAPI docs for HTTP Digest Auth](https://fastapi.tiangolo.com/advanced/security/http-digest-auth/).

    ## Example

    ```python
    from typing import Annotated

    from fastapi import Depends, FastAPI
    from fastapi.security import HTTPAuthorizationCredentials, HTTPDigest

    app = FastAPI()

    security = HTTPDigest()


    @app.get("/users/me")
    def read_current_user(
        credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)]
    ):
        return {"scheme": credentials.scheme, "credentials": credentials.credentials}
    ```
    """

    def __init__(
        self,
        *,
        scheme_name: Annotated[
            str | None,
            Doc(
                """
                Security scheme name.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        description: Annotated[
            str | None,
            Doc(
                """
                Security scheme description.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, if the HTTP Digest header is not provided, `HTTPDigest`
                will automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the HTTP Digest header is not
                available, instead of erroring out, the dependency result will be
                `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in an HTTP
                Digest auth or in a cookie).
                """
            ),
        ] = True,
    ):
        super().__init__(
            scheme="digest",
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
