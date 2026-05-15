import binascii
import hmac
import time
from base64 import b64decode
from hashlib import pbkdf2_hmac
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
    def __init__(
        self,
        *,
        max_attempts: Annotated[
            int,
            Doc("Maximum failed login attempts per client IP before lockout."),
        ] = 5,
        window_seconds: Annotated[
            int,
            Doc("Number of seconds failed attempts remain in the lockout window."),
        ] = 60,
        **kwargs,
    ):
        super().__init__(**kwargs)
        if max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")
        if window_seconds < 1:
            raise ValueError("window_seconds must be >= 1")
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._failed_attempts: dict[str, list[float]] = {}

    @staticmethod
    def verify_password(
        plain_password: str,
        password_hash: str,
        *,
        salt: str | bytes = b"",
        iterations: int = 390000,
    ) -> bool:
        if password_hash.startswith("pbkdf2_sha256$"):
            _algorithm, raw_iterations, raw_salt, expected_hash = password_hash.split(
                "$", 3
            )
            iterations = int(raw_iterations)
            salt = raw_salt
            candidate_hash = pbkdf2_hmac(
                "sha256",
                plain_password.encode("utf-8"),
                salt.encode("utf-8"),
                iterations,
            ).hex()
            return hmac.compare_digest(candidate_hash, expected_hash)
        candidate_hash = pbkdf2_hmac(
            "sha256",
            plain_password.encode("utf-8"),
            salt.encode("utf-8") if isinstance(salt, str) else salt,
            iterations,
        ).hex()
        return hmac.compare_digest(candidate_hash, password_hash)

    def _client_ip(self, request: Request) -> str:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",", 1)[0].strip()
        if request.client:
            return request.client.host
        return "unknown"

    def _active_failures(self, client_ip: str, now: float) -> list[float]:
        window_start = now - self.window_seconds
        failures = [
            timestamp
            for timestamp in self._failed_attempts.get(client_ip, [])
            if timestamp > window_start
        ]
        if failures:
            self._failed_attempts[client_ip] = failures
        else:
            self._failed_attempts.pop(client_ip, None)
        return failures

    def _retry_after(self, failures: list[float], now: float) -> int:
        if not failures:
            return self.window_seconds
        retry_after = ceil(failures[0] + self.window_seconds - now)
        return max(retry_after, 1)

    def _raise_locked(self, retry_after: int) -> None:
        raise HTTPException(
            status_code=HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts",
            headers={
                "Retry-After": str(retry_after),
                **self.make_authenticate_headers(),
            },
        )

    def record_failure(self, request: Request) -> None:
        client_ip = self._client_ip(request)
        now = time.monotonic()
        failures = self._active_failures(client_ip, now)
        failures.append(now)
        self._failed_attempts[client_ip] = failures
        if len(failures) >= self.max_attempts:
            self._raise_locked(self._retry_after(failures, now))

    def reset_attempts(self, request: Request) -> None:
        self._failed_attempts.pop(self._client_ip(request), None)

    async def __call__(  # type: ignore
        self, request: Request
    ) -> HTTPBasicCredentials | None:
        client_ip = self._client_ip(request)
        now = time.monotonic()
        failures = self._active_failures(client_ip, now)
        if len(failures) >= self.max_attempts:
            self._raise_locked(self._retry_after(failures, now))
        return await super().__call__(request)


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
