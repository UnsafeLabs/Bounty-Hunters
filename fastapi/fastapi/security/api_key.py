from collections import deque
from time import monotonic
from typing import Annotated

from annotated_doc import Doc
from fastapi.openapi.models import APIKey, APIKeyIn
from fastapi.security.base import SecurityBase
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_429_TOO_MANY_REQUESTS


class APIKeyBase(SecurityBase):
    model: APIKey

    def __init__(
        self,
        location: APIKeyIn,
        name: str,
        description: str | None,
        scheme_name: str | None,
        auto_error: bool,
        rate_limit: int | None,
        rotate_keys: list[str] | None,
    ):
        self.auto_error = auto_error
        self.rate_limit = rate_limit
        self.rotate_keys = tuple(dict.fromkeys(rotate_keys or ()))
        self._allowed_keys = frozenset(self.rotate_keys)
        self._rate_limit_hits: dict[str, deque[float]] = {}

        self.model: APIKey = APIKey(
            **{"in": location},  # ty: ignore[invalid-argument-type]
            name=name,
            description=description,
        )
        self.scheme_name = scheme_name or self.__class__.__name__

    def make_not_authenticated_error(self) -> HTTPException:
        """
        The WWW-Authenticate header is not standardized for API Key authentication but
        the HTTP specification requires that an error of 401 "Unauthorized" must
        include a WWW-Authenticate header.

        Ref: https://datatracker.ietf.org/doc/html/rfc9110#name-401-unauthorized

        For this, this method sends a custom challenge `APIKey`.
        """
        return HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "APIKey"},
        )

    def make_rate_limit_error(self) -> HTTPException:
        return HTTPException(
            status_code=HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
        )

    def validate_api_key(self, api_key: str) -> str | None:
        if not self._allowed_keys:
            return api_key
        if api_key in self._allowed_keys:
            return api_key
        if self.auto_error:
            raise self.make_not_authenticated_error()
        return None

    def enforce_rate_limit(self, api_key: str) -> str:
        if self.rate_limit is None:
            return api_key
        now = monotonic()
        window_start = now - 1
        hits = self._rate_limit_hits.setdefault(api_key, deque())
        while hits and hits[0] <= window_start:
            hits.popleft()
        if len(hits) >= self.rate_limit:
            raise self.make_rate_limit_error()
        hits.append(now)
        return api_key

    def check_api_key(self, api_key: str | None) -> str | None:
        if not api_key:
            if self.auto_error:
                raise self.make_not_authenticated_error()
            return None
        validated_api_key = self.validate_api_key(api_key)
        if validated_api_key is None:
            return None
        return self.enforce_rate_limit(validated_api_key)


class APIKeyQuery(APIKeyBase):
    """
    API key authentication using a query parameter.

    This defines the name of the query parameter that should be provided in the request
    with the API key and integrates that into the OpenAPI documentation. It extracts
    the key value sent in the query parameter automatically and provides it as the
    dependency result. But it doesn't define how to send that API key to the client.

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be a string containing the key value.

    ## Example

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyQuery

    app = FastAPI()

    query_scheme = APIKeyQuery(name="api_key")


    @app.get("/items/")
    async def read_items(api_key: str = Depends(query_scheme)):
        return {"api_key": api_key}
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[
            str,
            Doc("Query parameter name."),
        ],
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
                By default, if the query parameter is not provided, `APIKeyQuery` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the query parameter is not
                available, instead of erroring out, the dependency result will be
                `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in a query
                parameter or in an HTTP Bearer token).
                """
            ),
        ] = True,
        rate_limit: Annotated[
            int | None,
            Doc(
                """
                Maximum number of accepted requests per API key per second.

                If the limit is exceeded, FastAPI returns a `429 Too Many Requests`
                response.
                """
            ),
        ] = None,
        rotate_keys: Annotated[
            list[str] | None,
            Doc(
                """
                Additional valid API keys accepted during key rotation.

                This is useful when rolling credentials and temporarily accepting
                both old and new keys.
                """
            ),
        ] = None,
    ):
        super().__init__(
            location=APIKeyIn.query,
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
            rate_limit=rate_limit,
            rotate_keys=rotate_keys,
        )

    async def __call__(self, request: Request) -> str | None:
        api_key = request.query_params.get(self.model.name)
        return self.check_api_key(api_key)


class APIKeyHeader(APIKeyBase):
    """
    API key authentication using a header.

    This defines the name of the header that should be provided in the request with
    the API key and integrates that into the OpenAPI documentation. It extracts
    the key value sent in the header automatically and provides it as the dependency
    result. But it doesn't define how to send that key to the client.

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be a string containing the key value.

    ## Example

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyHeader

    app = FastAPI()

    header_scheme = APIKeyHeader(name="x-key")


    @app.get("/items/")
    async def read_items(key: str = Depends(header_scheme)):
        return {"key": key}
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
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
                By default, if the header is not provided, `APIKeyHeader` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the header is not available,
                instead of erroring out, the dependency result will be `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in a header or
                in an HTTP Bearer token).
                """
            ),
        ] = True,
        rate_limit: Annotated[
            int | None,
            Doc(
                """
                Maximum number of accepted requests per API key per second.

                If the limit is exceeded, FastAPI returns a `429 Too Many Requests`
                response.
                """
            ),
        ] = None,
        rotate_keys: Annotated[
            list[str] | None,
            Doc(
                """
                Additional valid API keys accepted during key rotation.

                This is useful when rolling credentials and temporarily accepting
                both old and new keys.
                """
            ),
        ] = None,
    ):
        super().__init__(
            location=APIKeyIn.header,
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
            rate_limit=rate_limit,
            rotate_keys=rotate_keys,
        )

    async def __call__(self, request: Request) -> str | None:
        api_key = request.headers.get(self.model.name)
        return self.check_api_key(api_key)


class APIKeyCookie(APIKeyBase):
    """
    API key authentication using a cookie.

    This defines the name of the cookie that should be provided in the request with
    the API key and integrates that into the OpenAPI documentation. It extracts
    the key value sent in the cookie automatically and provides it as the dependency
    result. But it doesn't define how to set that cookie.

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be a string containing the key value.

    ## Example

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyCookie

    app = FastAPI()

    cookie_scheme = APIKeyCookie(name="session")


    @app.get("/items/")
    async def read_items(session: str = Depends(cookie_scheme)):
        return {"session": session}
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Cookie name.")],
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
                By default, if the cookie is not provided, `APIKeyCookie` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the cookie is not available,
                instead of erroring out, the dependency result will be `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in a cookie or
                in an HTTP Bearer token).
                """
            ),
        ] = True,
        rate_limit: Annotated[
            int | None,
            Doc(
                """
                Maximum number of accepted requests per API key per second.

                If the limit is exceeded, FastAPI returns a `429 Too Many Requests`
                response.
                """
            ),
        ] = None,
        rotate_keys: Annotated[
            list[str] | None,
            Doc(
                """
                Additional valid API keys accepted during key rotation.

                This is useful when rolling credentials and temporarily accepting
                both old and new keys.
                """
            ),
        ] = None,
    ):
        super().__init__(
            location=APIKeyIn.cookie,
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
            rate_limit=rate_limit,
            rotate_keys=rotate_keys,
        )

    async def __call__(self, request: Request) -> str | None:
        api_key = request.cookies.get(self.model.name)
        return self.check_api_key(api_key)
