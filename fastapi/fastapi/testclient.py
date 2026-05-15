"""
FastAPITestClient — extends Starlette's TestClient with FastAPI-specific helpers.

Provides:
- ``auth_headers()`` for generating Authorization / API-key headers.
- ``override_dependency()`` for temporary dependency overrides.
- ``login_as()`` context manager for current-user dependency overrides.
- Convenience JSON helpers: ``get_json``, ``post_json``, ``put_json``,
  ``delete_json``, ``patch_json``.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any

from fastapi import FastAPI
from starlette.testclient import TestClient


class FastAPITestClient(TestClient):
    """
    Extended TestClient with FastAPI-specific testing helpers.

    Usage:

        app = FastAPI()
        client = FastAPITestClient(app)

        # Generate auth headers
        headers = client.auth_headers(bearer_token="my-token")
        response = client.get_json("/items", headers=headers)

        # Override a dependency
        client.override_dependency(get_current_user, lambda: {"id": 1})
        response = client.get_json("/me")

        # Login as a user temporarily
        with client.login_as({"id": 1, "name": "Alice"}, dependency=get_current_user):
            response = client.get_json("/me")
    """

    def __init__(self, app: FastAPI, **kwargs: Any) -> None:
        super().__init__(app, **kwargs)
        self._app = app

    # ------------------------------------------------------------------
    # Auth header helpers
    # ------------------------------------------------------------------

    @staticmethod
    def auth_headers(
        *,
        bearer_token: str | None = None,
        basic_username: str | None = None,
        basic_password: str | None = None,
        api_key: str | None = None,
        api_key_header: str = "X-API-Key",
        **extra_headers: str,
    ) -> dict[str, str]:
        """
        Build a dictionary of Authorization / API-key headers.

        Supports three mutually exclusive schemes:

        - **Bearer token** (``bearer_token``)
        - **Basic auth** (``basic_username`` + ``basic_password``)
        - **API Key** (``api_key``, sent in ``api_key_header``)

        Any extra keyword arguments are added as-is to the returned dict.

        Example::

            headers = FastAPITestClient.auth_headers(
                bearer_token="abc123",
                Accept="application/json",
            )

        Returns:
            A ``dict[str, str]`` suitable for use as ``headers`` in
            TestClient requests.
        """
        headers: dict[str, str] = {}
        active = 0

        if bearer_token is not None:
            headers["Authorization"] = f"Bearer {bearer_token}"
            active += 1

        if basic_username is not None or basic_password is not None:
            credentials = f"{basic_username or ''}:{basic_password or ''}"
            encoded = base64.b64encode(credentials.encode()).decode()
            headers["Authorization"] = f"Basic {encoded}"
            active += 1

        if api_key is not None:
            headers[api_key_header] = api_key
            active += 1

        if active > 1:
            raise ValueError(
                "Only one auth scheme may be used at a time. "
                "Provide exactly one of: bearer_token, "
                "(basic_username + basic_password), or api_key."
            )

        headers.update(extra_headers)
        return headers

    # ------------------------------------------------------------------
    # Dependency overrides
    # ------------------------------------------------------------------

    def override_dependency(
        self,
        dependency: Callable[..., Any],
        override: Callable[..., Any] | Any,
    ) -> None:
        """
        Override a FastAPI dependency with a callable or value.

        Shortcut for ``app.dependency_overrides[dependency] = override``.

        Args:
            dependency: The original dependency callable to override.
            override:   The replacement callable (or static value).
        """
        self._app.dependency_overrides[dependency] = override

    @contextmanager
    def login_as(
        self,
        user: Any,
        dependency: Callable[..., Any] | None = None,
    ) -> Generator[None, None, None]:
        """
        Temporarily override a dependency to return a given user object.

        This is useful for endpoints protected by ``Depends(get_current_user)``
        or similar.  When ``dependency`` is provided explicitly it is used;
        otherwise the method tries common dependency names by walking the
        FastAPI app's ``dependency_overrides`` for any callable whose
        ``__name__`` matches ``"get_current_user"`` or
        ``"get_current_active_user"``.

        Usage::

            with client.login_as({"id": 1, "username": "alice"},
                                 dependency=get_current_user):
                response = client.get("/me")

        Args:
            user:       The user object (or any value) to return from the
                        overridden dependency.
            dependency: Optional explicit dependency callable to override.
                        When ``None``, common dependency names are tried.
        """
        resolved_dep: Callable[..., Any] | None = dependency

        if resolved_dep is None:
            # Try to discover common user-dependency names already registered
            # in dependency_overrides.
            discovered = [
                dep
                for dep in self._app.dependency_overrides
                if hasattr(dep, "__name__")
                and dep.__name__ in ("get_current_user", "get_current_active_user")
            ]
            if discovered:
                resolved_dep = discovered[0]

        if resolved_dep is None:
            raise ValueError(
                "No dependency provided and no common dependency "
                "('get_current_user', 'get_current_active_user') found in "
                "app.dependency_overrides. Please pass a 'dependency' "
                "argument explicitly."
            )

        old_override = self._app.dependency_overrides.get(resolved_dep)
        self._app.dependency_overrides[resolved_dep] = lambda: user  # type: ignore[assignment]
        try:
            yield
        finally:
            if old_override is not None:
                self._app.dependency_overrides[resolved_dep] = old_override
            else:
                self._app.dependency_overrides.pop(resolved_dep, None)

    # ------------------------------------------------------------------
    # JSON convenience helpers
    # ------------------------------------------------------------------

    def get_json(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        """
        Perform a GET request and return the parsed JSON body.

        Shorthand for::

            response = client.get(url, params=params, headers=headers)
            response.raise_for_status()
            return response.json()
        """
        response = self.get(url, params=params, headers=headers, **kwargs)
        response.raise_for_status()
        return response.json()

    def post_json(
        self,
        url: str,
        *,
        json: Any = None,  # noqa: A002
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        """
        Perform a POST request with a JSON body and return the parsed JSON
        response.

        Shorthand for::

            response = client.post(url, json=data, headers=headers)
            response.raise_for_status()
            return response.json()
        """
        response = self.post(url, json=json, headers=headers, **kwargs)
        response.raise_for_status()
        return response.json()

    def put_json(
        self,
        url: str,
        *,
        json: Any = None,  # noqa: A002
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        """
        Perform a PUT request with a JSON body and return the parsed JSON
        response.
        """
        response = self.put(url, json=json, headers=headers, **kwargs)
        response.raise_for_status()
        return response.json()

    def delete_json(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        """
        Perform a DELETE request and return the parsed JSON response.
        """
        response = self.delete(url, headers=headers, **kwargs)
        response.raise_for_status()
        return response.json()

    def patch_json(
        self,
        url: str,
        *,
        json: Any = None,  # noqa: A002
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        """
        Perform a PATCH request with a JSON body and return the parsed JSON
        response.
        """
        response = self.patch(url, json=json, headers=headers, **kwargs)
        response.raise_for_status()
        return response.json()
