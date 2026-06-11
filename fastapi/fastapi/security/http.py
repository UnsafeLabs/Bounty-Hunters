import binascii
import hashlib
import hmac
import math
import secrets
import time
from base64 import b64decode
from collections.abc import Callable
from threading import RLock
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
    HTTP Basic authentication with optional brute-force protection.

    `HTTPBasicWithProtection` preserves the behavior of `HTTPBasic` unless a
    `credentials_verifier` is provided. When configured, failed authentications
    are tracked per client IP in a bounded in-memory window and clients are
    temporarily locked out with a `Retry-After` header after too many failures.
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
                header), `HTTPBasicWithProtection` will automatically cancel the
                request and send the client an error.

                If `auto_error` is set to `False`, when the HTTP Basic authentication
                is not available, instead of erroring out, the dependency result will
                be `None`.
                """
            ),
        ] = True,
        max_attempts: Annotated[
            int,
            Doc(
                """
                Maximum failed authentication attempts allowed per client IP inside
                the configured time window before returning 429 responses.
                """
            ),
        ] = 5,
        window_seconds: Annotated[
            int,
            Doc(
                """
                Number of seconds failed attempts remain in the in-memory window.
                The same value is used to calculate the lockout `Retry-After`.
                """
            ),
        ] = 60,
        credentials_verifier: Annotated[
            Callable[[HTTPBasicCredentials], bool] | None,
            Doc(
                """
                Optional callable that validates parsed HTTP Basic credentials.
                When it returns `False`, the failed attempt is tracked for the
                current client IP.
                """
            ),
        ] = None,
    ):
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        if window_seconds < 1:
            raise ValueError("window_seconds must be at least 1")
        super().__init__(
            scheme_name=scheme_name,
            realm=realm,
            description=description,
            auto_error=auto_error,
        )
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.credentials_verifier = credentials_verifier
        self._failed_attempts: dict[str, list[float]] = {}
        self._attempts_lock = RLock()
        self._clock: Callable[[], float] = time.monotonic

    @staticmethod
    def hash_password(
        password: str, *, salt: bytes | str | None = None, iterations: int = 390_000
    ) -> str:
        """
        Hash a password with PBKDF2-HMAC-SHA256 for use with `verify_password`.
        """

        if iterations < 1:
            raise ValueError("iterations must be at least 1")
        if salt is None:
            salt_bytes = secrets.token_bytes(16)
        elif isinstance(salt, str):
            salt_bytes = salt.encode("utf-8")
        else:
            salt_bytes = salt
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt_bytes, iterations
        ).hex()
        return f"pbkdf2_sha256${iterations}${salt_bytes.hex()}${digest}"

    @staticmethod
    def verify_password(password: str, stored_password: str) -> bool:
        """
        Verify a password using timing-safe comparison.

        PBKDF2-HMAC-SHA256 hashes generated by `hash_password` are supported.
        Other stored values are compared as plain text to support applications
        migrating incrementally from the existing `HTTPBasic` examples.
        """

        algorithm, separator, password_hash = stored_password.partition("$")
        if separator and algorithm == "pbkdf2_sha256":
            try:
                iterations_text, salt_hex, expected_digest = password_hash.split("$", 2)
                iterations = int(iterations_text)
                salt = bytes.fromhex(salt_hex)
            except ValueError:
                return False
            computed_digest = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), salt, iterations
            ).hex()
            return hmac.compare_digest(computed_digest, expected_digest)
        return hmac.compare_digest(
            password.encode("utf-8"), stored_password.encode("utf-8")
        )

    def _get_client_key(self, request: Request) -> str:
        if request.client and request.client.host:
            return request.client.host
        return "unknown"

    def _prune_attempts(self, client_key: str, now: float) -> list[float]:
        window_started_at = now - self.window_seconds
        attempts = [
            failed_at
            for failed_at in self._failed_attempts.get(client_key, [])
            if failed_at > window_started_at
        ]
        if attempts:
            self._failed_attempts[client_key] = attempts
        else:
            self._failed_attempts.pop(client_key, None)
        return attempts

    def _locked_until(self, client_key: str, now: float) -> float | None:
        with self._attempts_lock:
            attempts = self._prune_attempts(client_key, now)
            if len(attempts) < self.max_attempts:
                return None
            locked_until = attempts[0] + self.window_seconds
            if locked_until <= now:
                self._failed_attempts.pop(client_key, None)
                return None
            return locked_until

    def _record_failed_attempt(self, client_key: str, now: float) -> float | None:
        with self._attempts_lock:
            attempts = self._prune_attempts(client_key, now)
            attempts.append(now)
            self._failed_attempts[client_key] = attempts
            if len(attempts) >= self.max_attempts:
                return attempts[0] + self.window_seconds
            return None

    def _reset_attempts(self, client_key: str) -> None:
        with self._attempts_lock:
            self._failed_attempts.pop(client_key, None)

    def make_too_many_attempts_error(self, retry_after: int) -> HTTPException:
        return HTTPException(
            status_code=HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts",
            headers={"Retry-After": str(retry_after)},
        )

    async def __call__(  # type: ignore
        self, request: Request
    ) -> HTTPBasicCredentials | None:
        if self.credentials_verifier is None:
            return await super().__call__(request)

        client_key = self._get_client_key(request)
        now = self._clock()
        locked_until = self._locked_until(client_key, now)
        if locked_until is not None:
            retry_after = max(1, math.ceil(locked_until - now))
            raise self.make_too_many_attempts_error(retry_after)

        authorization = request.headers.get("Authorization")
        scheme, _ = get_authorization_scheme_param(authorization)
        has_basic_authorization = bool(authorization and scheme.lower() == "basic")

        try:
            credentials = await super().__call__(request)
        except HTTPException:
            if has_basic_authorization:
                failed_at = self._clock()
                locked_until = self._record_failed_attempt(client_key, failed_at)
                if locked_until is not None:
                    retry_after = max(1, math.ceil(locked_until - failed_at))
                    raise self.make_too_many_attempts_error(retry_after) from None
            raise
        if credentials is None or self.credentials_verifier is None:
            return credentials
        if self.credentials_verifier(credentials):
            self._reset_attempts(client_key)
            return credentials

        failed_at = self._clock()
        locked_until = self._record_failed_attempt(client_key, failed_at)
        if locked_until is not None:
            retry_after = max(1, math.ceil(locked_until - failed_at))
            raise self.make_too_many_attempts_error(retry_after)
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
