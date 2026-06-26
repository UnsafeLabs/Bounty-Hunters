from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI
from fastapi.security import APIKeyHeader, APIKeyWithRateLimit
from fastapi.testclient import TestClient


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def create_app(scheme: APIKeyWithRateLimit) -> FastAPI:
    app = FastAPI()

    @app.get("/items")
    def read_items(api_key: str = Depends(scheme)) -> dict[str, str]:
        return {"api_key": api_key}

    return app


def test_existing_api_key_header_behavior_is_unchanged() -> None:
    assert issubclass(APIKeyWithRateLimit, APIKeyHeader)

    app = FastAPI()
    scheme = APIKeyHeader(name="x-key")

    @app.get("/items")
    def read_items(api_key: str = Depends(scheme)) -> dict[str, str]:
        return {"api_key": api_key}

    response = TestClient(app).get("/items", headers={"x-key": "active"})

    assert response.status_code == 200
    assert response.json() == {"api_key": "active"}
    assert "warning" not in response.headers


def test_api_key_rate_limit_returns_retry_after() -> None:
    clock = Clock()
    scheme = APIKeyWithRateLimit(
        name="x-key",
        rate_limit="2/minute",
        time_func=clock,
    )
    client = TestClient(create_app(scheme))

    assert client.get("/items", headers={"x-key": "alpha"}).status_code == 200
    assert client.get("/items", headers={"x-key": "alpha"}).status_code == 200
    response = client.get("/items", headers={"x-key": "alpha"})

    assert response.status_code == 429
    assert response.json() == {"detail": "API key rate limit exceeded"}
    assert response.headers["retry-after"] == "60"


def test_api_key_rate_limit_tracks_keys_independently() -> None:
    clock = Clock()
    scheme = APIKeyWithRateLimit(
        name="x-key",
        rate_limit="1/minute",
        time_func=clock,
    )
    client = TestClient(create_app(scheme))

    assert client.get("/items", headers={"x-key": "alpha"}).status_code == 200
    assert client.get("/items", headers={"x-key": "beta"}).status_code == 200
    assert client.get("/items", headers={"x-key": "alpha"}).status_code == 429
    assert client.get("/items", headers={"x-key": "beta"}).status_code == 429


def test_api_key_rate_limit_resets_after_window_expires() -> None:
    clock = Clock()
    scheme = APIKeyWithRateLimit(
        name="x-key",
        rate_limit="1/minute",
        time_func=clock,
    )
    client = TestClient(create_app(scheme))

    assert client.get("/items", headers={"x-key": "alpha"}).status_code == 200
    assert client.get("/items", headers={"x-key": "alpha"}).status_code == 429

    clock.advance(60)

    assert client.get("/items", headers={"x-key": "alpha"}).status_code == 200


def test_deprecated_api_key_adds_warning_header() -> None:
    scheme = APIKeyWithRateLimit(
        name="x-key",
        rate_limit="10/minute",
        deprecated_keys=["old-key"],
    )
    client = TestClient(create_app(scheme))

    deprecated_response = client.get("/items", headers={"x-key": "old-key"})
    active_response = client.get("/items", headers={"x-key": "new-key"})

    assert deprecated_response.status_code == 200
    assert deprecated_response.headers["warning"] == (
        '299 - "Deprecated API key; rotate to a new key"'
    )
    assert active_response.status_code == 200
    assert "warning" not in active_response.headers


def test_optional_missing_api_key_skips_rate_limit() -> None:
    scheme = APIKeyWithRateLimit(
        name="x-key",
        rate_limit="1/minute",
        auto_error=False,
    )
    app = FastAPI()

    @app.get("/items")
    def read_items(api_key: str | None = Depends(scheme)) -> dict[str, str | None]:
        return {"api_key": api_key}

    client = TestClient(app)

    assert client.get("/items").json() == {"api_key": None}
    assert client.get("/items").json() == {"api_key": None}


def test_api_key_rate_limit_store_is_thread_safe() -> None:
    clock = Clock()
    scheme = APIKeyWithRateLimit(
        name="x-key",
        rate_limit="100/minute",
        time_func=clock,
    )

    def check() -> None:
        scheme._check_rate_limit("alpha")

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(lambda _: check(), range(50)))

    assert len(scheme._requests["alpha"]) == 50


@pytest.mark.parametrize(
    "rate_limit",
    ["0/minute", "-1/minute", "100/week", "bad-format"],
)
def test_invalid_rate_limit_format_raises(rate_limit: str) -> None:
    with pytest.raises(ValueError):
        APIKeyWithRateLimit(name="x-key", rate_limit=rate_limit)
