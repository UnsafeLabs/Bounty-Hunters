from __future__ import annotations

import binascii
import hashlib
import hmac
import threading
import time
from base64 import b64decode
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
    Authorization: Bearer ***
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


# ---------------------------------------------------------------------------
# IP-based brute force protection limiter
# ---------------------------------------------------------------------------


class _BruteForceLimiter:
    """Thread-safe, per-IP brute force attempt tracker with sliding window."""

    def __init__(self, max_attempts: int, window_seconds: int) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def record_failure(self, ip: str) -> tuple[bool, int]:
        """Record a failed attempt for *ip*.

        Returns ``(locked_out, retry_after)`` where *locked_out* is ``True``
        if the IP has exceeded the maximum attempts.
        """
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            timestamps = self._attempts.get(ip, [])
            timestamps = [t for t in timestamps if t > cutoff]
            timestamps.append(now)
            self._attempts[ip] = timestamps

            if len(timestamps) > self.max_attempts:
                retry_after = max(1, int(timestamps[0] - cutoff) + 1)
                return True, retry_after
            return False, 0

    def reset(self, ip: str) -> None:
        """Clear the attempt counter for *ip* after a successful authentication."""
        with self._lock:
            self._attempts.pop(ip, None)

    def is_locked_out(self, ip: str) -> tuple[bool, int]:
        """Check whether *ip* is currently locked out without recording a new attempt."""
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            timestamps = self._attempts.get(ip, [])
            timestamps = [t for t in timestamps if t > cutoff]
            self._attempts[ip] = timestamps

            if len(timestamps) > self.max_attempts:
                retry_after = max(1, int(timestamps[0] - cutoff) + 1)
                return True, retry_after
            return False, 0


# ---------------------------------------------------------------------------
# HTTPBasicWithProtection
# ---------------------------------------------------------------------------


class HTTPBasicWithProtection(HTTPBasic):
    """
    HTTP Basic authentication with brute force protection.

    Extends ``HTTPBasic`` to add:

    * **Per-IP attempt tracking** — failed login attempts are tracked per
      client IP using a sliding window.
    * **Lockout** — after ``max_attempts`` failures within the time window,
      the IP receives a ``429 Too Many Requests`` response with a
      ``Retry-After`` header.
    * **Reset on success** — a successful authentication clears the failure
      counter for that IP.
    * **Timing-safe password verification** — the ``verify_password`` static
      method uses ``hmac.compare_digest`` for constant-time comparison.

    ## Usage

    ```python
    from typing import Annotated

    from fastapi import Depends, FastAPI
    from fastapi.security import HTTPBasicWithProtection, HTTPBasicCredentials

    app = FastAPI()

    security = HTTPBasicWithProtection(max_attempts=5, window_seconds=300)


    @app.get("/users/me")
    def read_current_user(
        credentials: Annotated[HTTPBasicCredentials, Depends(security)],
    ):
        if not security.verify_password(
            credentials.password, "$argon2id$..."
        ):
            return {"error": "Invalid password"}
        return {"username": credentials.username}
    ```
    """

    def __init__(
        self,
        *,
        max_attempts: Annotated[
            int,
            Doc(
                """
                Maximum number of failed login attempts allowed per IP within
                the time window.  Defaults to ``5``.
                """
            ),
        ] = 5,
        window_seconds: Annotated[
            int,
            Doc(
                """
                Time window in seconds for tracking failed attempts.
                Defaults to ``300`` (5 minutes).
                """
            ),
        ] = 300,
        scheme_name: Annotated[str | None, Doc("Security scheme name.")] = None,
        realm: Annotated[str | None, Doc("HTTP Basic authentication realm.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, if the HTTP Basic authentication is not provided,
                ``HTTPBasicWithProtection`` will automatically cancel the
                request and send the client an error.

                Set to ``False`` for optional authentication.
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
        self._limiter = _BruteForceLimiter(max_attempts, window_seconds)
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds

    async def __call__(  # type: ignore[override]
        self, request: Request
    ) -> HTTPBasicCredentials | None:
        """Authenticate the request with brute force protection.

        Steps:
        1. Check if the client IP is already locked out.
        2. Extract and validate the Basic auth credentials.
        3. On failure, record the attempt and return 429 if locked out.
        4. On success, reset the attempt counter and return credentials.
        """
        client_ip = request.client.host if request.client else "unknown"

        # Step 1: Check existing lockout.
        locked, retry_after = self._limiter.is_locked_out(client_ip)
        if locked:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed authentication attempts",
                headers={"Retry-After": str(retry_after)},
            )

        # Step 2: Extract credentials (delegates to parent).
        authorization = request.headers.get("Authorization")
        scheme, param = get_authorization_scheme_param(authorization)

        if not authorization or scheme.lower() != "basic":
            # No credentials provided — record as failure.
            locked, retry_after = self._limiter.record_failure(client_ip)
            if self.auto_error:
                if locked:
                    raise HTTPException(
                        status_code=HTTP_429_TOO_MANY_REQUESTS,
                        detail="Too many failed authentication attempts",
                        headers={"Retry-After": str(retry_after)},
                    )
                raise self.make_not_authenticated_error()
            else:
                return None

        try:
            data = b64decode(param).decode("ascii")
        except (ValueError, UnicodeDecodeError, binascii.Error) as e:
            locked, retry_after = self._limiter.record_failure(client_ip)
            if locked:
                raise HTTPException(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many failed authentication attempts",
                    headers={"Retry-After": str(retry_after)},
                ) from e
            raise self.make_not_authenticated_error() from e

        username, separator, password = data.partition(":")
        if not separator:
            locked, retry_after = self._limiter.record_failure(client_ip)
            if locked:
                raise HTTPException(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many failed authentication attempts",
                    headers={"Retry-After": str(retry_after)},
                )
            raise self.make_not_authenticated_error()

        # Step 3: Successful extraction — reset the counter.
        # Note: Actual password verification is the caller's responsibility.
        # We reset because valid Basic auth format was received.
        self._limiter.reset(client_ip)

        return HTTPBasicCredentials(username=username, password=password)

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a password against a hash using constant-time comparison.

        This is a convenience method that uses ``hmac.compare_digest`` for
        timing-safe comparison.  For production use, consider using a proper
        password hashing library like ``argon2-cffi`` or ``passlib`` with
        bcrypt.

        Parameters
        ----------
        plain_password:
            The plain-text password to verify.
        hashed_password:
            The stored password hash to compare against.

        Returns
        -------
        bool
            ``True`` if the password matches, ``False`` otherwise.
        """
        # Use hashlib to create a comparable hash, then compare in constant time.
        computed = hashlib.sha256(plain_password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(computed, hashed_password)


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
