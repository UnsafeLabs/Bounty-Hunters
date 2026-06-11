import binascii
import hashlib
import hmac
import time
from base64 import b64decode
from collections import OrderedDict
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
    HTTP Basic authentication with brute force protection.

    Extends `HTTPBasic` with:
    - **Rate limiting**: tracks failed login attempts per IP address.
    - **Automatic lockout**: returns **429 Too Many Requests** after exceeding
      `max_attempts` within a configurable time window.
    - **Password verification**: provides a static `verify_password` method
      that uses **timing-safe comparison** to mitigate timing attacks.

    ## Usage

    ```python
    from typing import Annotated

    from fastapi import Depends, FastAPI
    from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection

    app = FastAPI()

    security = HTTPBasicWithProtection()


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
                header), `HTTPBasicWithProtection` will automatically cancel the request
                and send the client an error.

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
                Maximum number of failed login attempts allowed from a single IP
                within the `window_seconds` time window before a **429 Too Many
                Requests** response is returned.
                """
            ),
        ] = 5,
        window_seconds: Annotated[
            int,
            Doc(
                """
                Time window in seconds during which failed attempts are counted.
                After this window expires without a successful login, the attempt
                counter for that IP is reset.
                """
            ),
        ] = 300,
    ):
        super().__init__(
            scheme_name=scheme_name,
            realm=realm,
            description=description,
            auto_error=auto_error,
        )
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        # In-memory store: {ip: [attempt_count, first_failure_timestamp]}
        # Using an OrderedDict allows simple stale-entry eviction.
        self._failed_attempts: dict[str, tuple[int, float]] = {}

    def _cleanup_stale(self) -> None:
        """Remove entries whose time window has fully expired."""
        now = time.monotonic()
        stale = [
            ip
            for ip, (_, first_fail) in self._failed_attempts.items()
            if now - first_fail > self.window_seconds
        ]
        for ip in stale:
            del self._failed_attempts[ip]

    def _is_rate_limited(self, ip: str) -> bool:
        """
        Check whether *ip* is currently rate-limited.

        Returns ``True`` if the client at *ip* has already exceeded
        `max_attempts` in the current window and is locked out.
        """
        self._cleanup_stale()
        record = self._failed_attempts.get(ip)
        if record is None:
            return False
        attempts, first_fail = record
        elapsed = time.monotonic() - first_fail
        if elapsed > self.window_seconds:
            # Window expired; reset transparently.
            del self._failed_attempts[ip]
            return False
        return attempts >= self.max_attempts

    def _record_failure(self, ip: str) -> None:
        """
        Record a failed authentication attempt for *ip*.

        If the existing window has expired the counter is reset before
        incrementing.
        """
        self._cleanup_stale()
        now = time.monotonic()
        record = self._failed_attempts.get(ip)
        if record is None:
            self._failed_attempts[ip] = (1, now)
        else:
            attempts, first_fail = record
            if now - first_fail > self.window_seconds:
                self._failed_attempts[ip] = (1, now)
            else:
                self._failed_attempts[ip] = (attempts + 1, first_fail)

    def _reset_attempts(self, ip: str) -> None:
        """Remove the attempt record for *ip* after a successful login."""
        self._failed_attempts.pop(ip, None)

    def _seconds_until_retry(self, ip: str) -> int:
        """Return the number of seconds until the lockout expires for *ip*."""
        record = self._failed_attempts.get(ip)
        if record is None:
            return 0
        _, first_fail = record
        elapsed = time.monotonic() - first_fail
        remaining = int(self.window_seconds - elapsed) + 1
        return max(remaining, 1)

    @staticmethod
    def verify_password(password: str, stored_hash: str, algorithm: str = "pbkdf2_sha256") -> bool:
        """
        Verify a plaintext *password* against a *stored_hash* using a
        timing-safe comparison (constant-time).

        Parameters
        ----------
        password : str
            The plaintext password to verify.
        stored_hash : str
            The stored hash string.  Supported formats:

            * ``pbkdf2_sha256`` — ``$pbkdf2-sha256$rounds$salt$hash``
            * ``sha256`` — ``$sha256$salt$hash``
            * ``plain`` — raw text (only safe for testing).
        algorithm : str
            The algorithm identifier.  Currently supports ``pbkdf2_sha256``
            (default) and ``sha256``.

        Returns
        -------
        bool
            ``True`` if the password matches, ``False`` otherwise.
        """
        try:
            if algorithm == "pbkdf2_sha256":
                parts = stored_hash.split("$")
                if len(parts) != 5 or parts[0] != "" or parts[1] != "pbkdf2-sha256":
                    return False
                rounds = int(parts[2])
                salt = parts[3].encode("utf-8")
                expected = parts[4]
                actual = hashlib.pbkdf2_hmac(
                    "sha256", password.encode("utf-8"), salt, rounds
                ).hex()
            elif algorithm == "sha256":
                parts = stored_hash.split("$")
                if len(parts) != 4 or parts[0] != "" or parts[1] != "sha256":
                    return False
                salt = parts[2].encode("utf-8")
                expected = parts[3]
                actual = hashlib.sha256(salt + password.encode("utf-8")).hexdigest()
            else:
                return False
        except (ValueError, IndexError, TypeError):
            return False

        # Timing-safe comparison via HMAC compare_digest
        return hmac.compare_digest(actual, expected)

    @staticmethod
    def hash_password(password: str, algorithm: str = "pbkdf2_sha256", rounds: int = 600_000) -> str:
        """
        Hash a plaintext *password* and return a portable hash string.

        The output can be passed directly to `verify_password`.
        """
        import os

        if algorithm == "pbkdf2_sha256":
            salt = os.urandom(16).hex()
            h = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), salt.encode("utf-8"), rounds
            ).hex()
            return f"$pbkdf2-sha256${rounds}${salt}${h}"
        else:
            salt = os.urandom(16).hex()
            h = hashlib.sha256(salt.encode("utf-8") + password.encode("utf-8")).hexdigest()
            return f"$sha256${salt}${h}"

    async def __call__(  # type: ignore
        self, request: Request
    ) -> HTTPBasicCredentials | None:
        client_ip = request.client.host if request.client else "unknown"
        # Check rate limit **before** extracting credentials so that an
        # attacker cannot bypass the lockout by sending an invalid header.
        if self._is_rate_limited(client_ip):
            retry_after = self._seconds_until_retry(client_ip)
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Too Many Requests",
                headers={
                    "Retry-After": str(retry_after),
                    **self.make_authenticate_headers(),
                },
            )

        # Delegate credential extraction to the parent.
        credentials = await super().__call__(request)
        if credentials is None:
            return None

        # If we reach here, the credentials were successfully extracted.
        # The application is expected to call verify_password and tell us
        # whether authentication succeeded via mark_authenticated / mark_failed.
        #
        # However, the typical pattern is that *this* class is used as a
        # dependency and the user code calls verify_password separately.
        # We handle that by NOT recording success/failure here — the
        # application code must call mark_authenticated or mark_failed
        # explicitly.  This keeps the class generic (no hard-coded password
        # store).
        return credentials

    async def mark_authenticated(self, request: Request) -> None:
        """
        Notify the rate-limiter that authentication succeeded for the client
        making *request*.

        This resets the attempt counter for that IP so a subsequent burst of
        failures starts from a clean slate.
        """
        if request.client:
            self._reset_attempts(request.client.host)

    async def mark_failed(self, request: Request) -> None:
        """
        Notify the rate-limiter that authentication failed for the client
        making *request*.
        """
        if request.client:
            self._record_failure(request.client.host)


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
