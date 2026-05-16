import binascii
import hashlib
import secrets
import time
from base64 import b64decode
from collections.abc import Callable
from math import ceil
from typing import Annotated

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
                By default, if the HTTP Basic authentication is not provided (a
                header), `HTTPBasic` will automatically cancel the request and send the
                client an error.

                If `auto_error` is set to `False`, when the HTTP Basic authentication
                is not available, instead of erroring out, the dependency result will
                be `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in HTTP Basic
                authentication or in an HTTP Bearer token).
                """
            ),
        ] = True,
    ):
        self.model = HTTPBaseModel(scheme="basic", description=description)
        self.scheme_name = scheme_name or self.__class__.__name__
        self.realm = realm
        self.auto_error = auto_error

    def make_authenticate_headers(self) -> dict[str, str]:
        if self.realm:
            return {"WWW-Authenticate": f'Basic realm="{self.realm}"'}
        return {"WWW-Authenticate": "Basic"}

    async def __call__(  # type: ignore
        self, request: Request
    ) -> HTTPBasicCredentials | None:
        authorization = request.headers.get("Authorization")
        scheme, param = get_authorization_scheme_param(authorization)
        if not authorization or scheme.lower() != "basic":
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        try:
            data = b64decode(param).decode("ascii")
        except (ValueError, UnicodeDecodeError, binascii.Error) as e:
            raise self.make_not_authenticated_error() from e
        username, separator, password = data.partition(":")
        if not separator:
            raise self.make_not_authenticated_error()
        return HTTPBasicCredentials(username=username, password=password)


class HTTPBasicWithProtection(HTTPBasic):
    """
    HTTP Basic authentication with in-memory brute-force protection.

    This class preserves `HTTPBasic` parsing behavior and adds optional credential
    validation plus per-client failure tracking. The in-memory store is process-local;
    use an external shared store for distributed deployments.
    """

    _HASH_SCHEME = "pbkdf2_sha256"
    _DEFAULT_HASH_ITERATIONS = 260_000

    def __init__(
        self,
        *,
        max_attempts: Annotated[
            int,
            Doc(
                """
                Number of failed authentication attempts allowed per client within
                `window_seconds` before requests are temporarily rejected.
                """
            ),
        ] = 5,
        window_seconds: Annotated[
            int,
            Doc(
                """
                Time window, in seconds, used to count failed authentication attempts.
                """
            ),
        ] = 60,
        credentials_validator: Annotated[
            Callable[[HTTPBasicCredentials], bool] | None,
            Doc(
                """
                Optional callable used to validate parsed HTTP Basic credentials.

                Return `True` to accept credentials and reset failed attempts for the
                client, or `False` to reject them and record a failed attempt.
                """
            ),
        ] = None,
        scheme_name: Annotated[
            str | None,
            Doc(
                """
                Security scheme name.
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
                """
            ),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, authentication errors are raised automatically.
                """
            ),
        ] = True,
    ):
        super().__init__(
            scheme_name=scheme_name,
            realm=realm,
            description=description,
            auto_error=auto_error,
        )
        if max_attempts < 1:
            raise ValueError("max_attempts must be greater than or equal to 1")
        if window_seconds < 1:
            raise ValueError("window_seconds must be greater than or equal to 1")
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.credentials_validator = credentials_validator
        self._failed_attempts: dict[str, list[float]] = {}

    @staticmethod
    def hash_password(
        password: str,
        *,
        salt: bytes | None = None,
        iterations: int = _DEFAULT_HASH_ITERATIONS,
    ) -> str:
        salt = salt or secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
        return (
            f"{HTTPBasicWithProtection._HASH_SCHEME}"
            f"${iterations}${salt.hex()}${digest.hex()}"
        )

    @staticmethod
    def verify_password(password: str, expected_password: str) -> bool:
        try:
            scheme, iterations, salt, digest = expected_password.split("$", 3)
        except ValueError:
            return secrets.compare_digest(
                password.encode(),
                expected_password.encode(),
            )
        if scheme != HTTPBasicWithProtection._HASH_SCHEME:
            return False
        try:
            iteration_count = int(iterations)
            salt_bytes = bytes.fromhex(salt)
            expected_digest = bytes.fromhex(digest)
        except ValueError:
            return False
        actual_digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode(),
            salt_bytes,
            iteration_count,
        )
        return secrets.compare_digest(actual_digest, expected_digest)

    def _client_key(self, request: Request) -> str:
        if request.client is None:
            return "unknown"
        return request.client.host

    def _active_failures(self, client_key: str, now: float) -> list[float]:
        failures = [
            failed_at
            for failed_at in self._failed_attempts.get(client_key, [])
            if now - failed_at < self.window_seconds
        ]
        if failures:
            self._failed_attempts[client_key] = failures
        else:
            self._failed_attempts.pop(client_key, None)
        return failures

    def _retry_after(self, failures: list[float], now: float) -> int:
        if not failures:
            return self.window_seconds
        return max(1, ceil(self.window_seconds - (now - failures[0])))

    def _raise_locked_out(self, retry_after: int) -> None:
        raise HTTPException(
            status_code=HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts",
            headers={"Retry-After": str(retry_after)},
        )

    def _record_failure(self, client_key: str, now: float) -> None:
        failures = self._active_failures(client_key, now)
        failures.append(now)
        self._failed_attempts[client_key] = failures

    async def __call__(  # type: ignore
        self, request: Request
    ) -> HTTPBasicCredentials | None:
        client_key = self._client_key(request)
        now = time.monotonic()
        failures = self._active_failures(client_key, now)
        if len(failures) >= self.max_attempts:
            self._raise_locked_out(self._retry_after(failures, now))

        try:
            credentials = await super().__call__(request)
        except HTTPException:
            self._record_failure(client_key, now)
            raise

        if credentials is None or self.credentials_validator is None:
            return credentials

        if self.credentials_validator(credentials):
            self._failed_attempts.pop(client_key, None)
            return credentials

        self._record_failure(client_key, now)
        raise self.make_not_authenticated_error()


class HTTPBearer(HTTPBase):
    """
    HTTP Bearer token authentication.

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be an `HTTPAuthorizationCredentials` object containing
    the `scheme` and the `credentials`.

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
        bearerFormat: Annotated[str | None, Doc("Bearer token format.")] = None,
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
                By default, if the HTTP Bearer token is not provided (in an
                `Authorization` header), `HTTPBearer` will automatically cancel the
                request and send the client an error.

                If `auto_error` is set to `False`, when the HTTP Bearer token
                is not available, instead of erroring out, the dependency result will
                be `None`.

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

    async def __call__(self, request: Request) -> HTTPAuthorizationCredentials | None:
        authorization = request.headers.get("Authorization")
        scheme, credentials = get_authorization_scheme_param(authorization)
        if not (authorization and scheme and credentials):
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        if scheme.lower() != "bearer":
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        return HTTPAuthorizationCredentials(scheme=scheme, credentials=credentials)


class HTTPDigest(HTTPBase):
    """
    HTTP Digest authentication.

    **Warning**: this is only a stub to connect the components with OpenAPI in FastAPI,
    but it doesn't implement the full Digest scheme, you would need to subclass it
    and implement it in your code.

    Ref: https://datatracker.ietf.org/doc/html/rfc7616

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be an `HTTPAuthorizationCredentials` object containing
    the `scheme` and the `credentials`.

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
                By default, if the HTTP Digest is not provided, `HTTPDigest` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the HTTP Digest is not
                available, instead of erroring out, the dependency result will
                be `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in HTTP
                Digest or in a cookie).
                """
            ),
        ] = True,
    ):
        self.model = HTTPBaseModel(scheme="digest", description=description)
        self.scheme_name = scheme_name or self.__class__.__name__
        self.auto_error = auto_error

    async def __call__(self, request: Request) -> HTTPAuthorizationCredentials | None:
        authorization = request.headers.get("Authorization")
        scheme, credentials = get_authorization_scheme_param(authorization)
        if not (authorization and scheme and credentials):
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        if scheme.lower() != "digest":
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        return HTTPAuthorizationCredentials(scheme=scheme, credentials=credentials)
