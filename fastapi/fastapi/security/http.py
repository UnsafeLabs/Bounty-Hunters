import binascii
import hashlib
import hmac
import time
from base64 import b64decode
from collections import defaultdict
from collections.abc import Callable
from typing import Annotated

from annotated_doc import Doc
from fastapi.exceptions import HTTPException
from fastapi.openapi.models import HTTPBase as HTTPBaseModel
from fastapi.openapi.models import HTTPBearer as HTTPBearerModel
from fastapi.security.base import SecurityBase
from fastapi.security.utils import get_authorization_scheme_param
from pydantic import BaseModel
from starlette.requests import Request
from starlette.status import HTTP_429_TOO_MANY_REQUESTS, HTTP_401_UNAUTHORIZED


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
                By default, if the HTTP Basic header is not provided, `HTTPBasic` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the header is not available,
                instead of erroring out, the dependency result will be `None`.

                This is useful when you want to have optional authentication.
                """
            ),
        ] = True,
    ):
        self.model = HTTPBaseModel(scheme="basic", description=description)
        self.scheme_name = scheme_name or self.__class__.__name__
        self.auto_error = auto_error
        if realm:
            self.model.realm = realm

    async def __call__(self, request: Request) -> HTTPBasicCredentials | None:
        authorization = request.headers.get("Authorization")
        scheme, param = get_authorization_scheme_param(authorization)
        if not authorization or scheme.lower() != "basic":
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        try:
            data = b64decode(param).decode("utf-8")
        except (ValueError, UnicodeDecodeError, binascii.Error):
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        username, separator, password = data.partition(":")
        if not separator:
            if self.auto_error:
                raise self.make_not_authenticated_error()
            else:
                return None
        return HTTPBasicCredentials(username=username, password=password)


class HTTPBasicWithProtection(HTTPBasic):
    """
    HTTP Basic authentication with brute force protection and password verification.

    Extends `HTTPBasic` to provide:
    - Per‑IP tracking of failed authentication attempts.
    - Automatic lockout after `max_attempts` failures within a configurable time window.
    - Returns `429 Too Many Requests` with a `Retry-After` header when locked out.
    - Successful authentication resets the attempt counter for that IP.
    - Optional password verification via `verify_password` callable or static method.

    ## Usage

    ```python
    from typing import Annotated

    from fastapi import Depends, FastAPI
    from fastapi.security import HTTPBasicWithProtection

    app = FastAPI()

    # Example password hash (use a proper hashing library in production)
    fake_users_db = {"alice": HTTPBasicWithProtection.hash_password("secret123")}

    def verify_credentials(credentials):
        if credentials.username in fake_users_db:
            return HTTPBasicWithProtection.verify_password(
                credentials.password, fake_users_db[credentials.username]
            )
        return False

    security = HTTPBasicWithProtection(
        verify_password=verify_credentials,
        max_attempts=5,
        lockout_window=300
    )


    @app.get("/protected")
    def protected_endpoint(credentials: Annotated[bool, Depends(security)]):
        return {"message": "You are authenticated"}
    ```
    """

    _attempt_store: dict[str, list[float]] = defaultdict(list)
    """In-memory store of failed attempt timestamps per IP."""

    def __init__(
        self,
        *,
        verify_password: Callable[[HTTPBasicCredentials], bool] | None = None,
        max_attempts: Annotated[
            int,
            Doc(
                """
                Maximum number of failed attempts allowed before lockout.
                """
            ),
        ] = 10,
        lockout_window: Annotated[
            int,
            Doc(
                """
                Time window in seconds within which `max_attempts` failures trigger lockout.
                """
            ),
        ] = 300,
        realm: Annotated[
            str | None,
            Doc(
                """
                HTTP Basic authentication realm.
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
                If `True` (default), authentication failure raises HTTPException.
                If `False`, returns `None` on failure.
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
        self.verify_password = verify_password
        self.max_attempts = max_attempts
        self.lockout_window = lockout_window

    @staticmethod
    def hash_password(
        password: str,
        salt_bytes: int = 16,
        iterations: int = 100_000,
    ) -> str:
        """
        Hash a password using PBKDF2-HMAC-SHA256.

        Returns a string in the format `pbkdf2:iterations:salt_base64:hash_base64`.

        This is a basic implementation using only the standard library.
        For production, consider using a dedicated library like `passlib`.
        """
        salt = hashlib.sha256(password.encode()).digest()[:salt_bytes]
        key = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode(),
            salt,
            iterations,
        )
        import base64
        salt_b64 = base64.b64encode(salt).decode()
        key_b64 = base64.b64encode(key).decode()
        return f"pbkdf2:{iterations}:{salt_b64}:{key_b64}"

    @staticmethod
    def verify_password(
        plain_password: str,
        stored_hash: str,
    ) -> bool:
        """
        Verify a plaintext password against a PBKDF2 hash.

        Uses constant-time comparison to prevent timing attacks.
        """
        if not stored_hash or not stored_hash.startswith("pbkdf2:"):
            return False
        try:
            _, iterations_str, salt_b64, key_b64 = stored_hash.split(":")
            iterations = int(iterations_str)
            salt = __import__("base64").b64decode(salt_b64)
            expected_key = __import__("base64").b64decode(key_b64)
        except (ValueError, Exception):
            return False

        computed_key = hashlib.pbkdf2_hmac(
            "sha256",
            plain_password.encode(),
            salt,
            iterations,
        )
        return hmac.compare_digest(computed_key, expected_key)

    async def __call__(self, request: Request) -> HTTPBasicCredentials | None:
        client_ip = request.client.host if request.client else "unknown"

        # Check lockout before attempting authentication
        now = time.time()
        attempts = self._attempt_store.get(client_ip, [])
        # Remove old attempts outside the window
        attempts = [t for t in attempts if now - t < self.lockout_window]
        self._attempt_store[client_ip] = attempts

        if len(attempts) >= self.max_attempts:
            # Calculate retry-after
            oldest = min(attempts)
            retry_after = int(self.lockout_window - (now - oldest))
            if retry_after < 0:
                retry_after = 0
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Too Many Requests",
                headers={"Retry-After": str(retry_after)},
            )

        # Proceed with base authentication
        try:
            credentials = await super().__call__(request)
        except HTTPException:
            self._record_failure(client_ip)
            if self.auto_error:
                raise
            return None

        # If base authentication succeeded and a verifier is provided, use it
        if credentials and self.verify_password:
            if not self.verify_password(credentials):
                self._record_failure(client_ip)
                if self.auto_error:
                    raise HTTPException(
                        status_code=HTTP_401_UNAUTHORIZED,
                        detail="Invalid credentials",
                        headers=self.make_authenticate_headers(),
                    )
                return None

        # Success: reset the attempt counter for this IP
        self._attempt_store.pop(client_ip, None)
        return credentials

    def _record_failure(self, client_ip: str) -> None:
        now = time.time()
        self._attempt_store[client_ip].append(now)


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
    from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

    app = FastAPI()

    security = HTTPBearer()


    @app.get("/users/me")
    def read_current_user(credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)]):
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
                By default, if the HTTP Bearer header is not provided, `HTTPBearer` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the header is not available,
                instead of erroring out, the dependency result will be `None`.

                This is useful when you want to have optional authentication.
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
    from fastapi.security import HTTPDigest, HTTPAuthorizationCredentials

    app = FastAPI()

    security = HTTPDigest()


    @app.get("/users/me")
    def read_current_user(credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)]):
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
                By default, if the HTTP Digest header is not provided, `HTTPDigest` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the header is not available,
                instead of erroring out, the dependency result will be `None`.

                This is useful when you want to have optional authentication.
                """
            ),
        ] = True,
    ):
        self.model = HTTPBaseModel(scheme="digest", description=description)
        self.scheme_name = scheme_name or self.__class__.__name__
        self.auto_error = auto_error
