from fastapi import FastAPI, Security
from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient

PASSWORD_HASH = HTTPBasicWithProtection.hash_password(
    "secret", salt=b"fastapi-test-salt", iterations=1_000
)


def make_security(
    max_attempts: int = 2, window_seconds: float = 60
) -> HTTPBasicWithProtection:
    def verify(credentials: HTTPBasicCredentials) -> bool:
        return (
            credentials.username == "alice"
            and HTTPBasicWithProtection.verify_password(
                credentials.password, PASSWORD_HASH
            )
        )

    return HTTPBasicWithProtection(
        max_attempts=max_attempts,
        window_seconds=window_seconds,
        password_verifier=verify,
    )


def make_client(
    security: HTTPBasicWithProtection, client_host: str = "testclient"
) -> TestClient:
    app = FastAPI()

    @app.get("/users/me")
    def read_current_user(
        credentials: HTTPBasicCredentials = Security(security),
    ) -> dict[str, str]:
        return {"username": credentials.username}

    return TestClient(app, client=(client_host, 50000))


def test_failed_attempts_lock_client_ip() -> None:
    client = make_client(make_security(max_attempts=2))

    response = client.get("/users/me", auth=("alice", "wrong"))
    assert response.status_code == 401, response.text

    response = client.get("/users/me", auth=("alice", "also-wrong"))
    assert response.status_code == 401, response.text

    response = client.get("/users/me", auth=("alice", "secret"))
    assert response.status_code == 429, response.text
    assert response.json() == {"detail": "Too many authentication attempts"}
    assert int(response.headers["Retry-After"]) > 0


def test_successful_authentication_resets_attempt_counter() -> None:
    security = make_security(max_attempts=2)
    client = make_client(security)

    response = client.get("/users/me", auth=("alice", "wrong"))
    assert response.status_code == 401, response.text

    response = client.get("/users/me", auth=("alice", "secret"))
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "alice"}

    response = client.get("/users/me", auth=("alice", "wrong"))
    assert response.status_code == 401, response.text

    response = client.get("/users/me", auth=("alice", "also-wrong"))
    assert response.status_code == 401, response.text


def test_failed_attempts_are_scoped_by_client_ip() -> None:
    security = make_security(max_attempts=1)
    locked_client = make_client(security, "198.51.100.10")
    other_client = make_client(security, "203.0.113.20")

    response = locked_client.get("/users/me", auth=("alice", "wrong"))
    assert response.status_code == 401, response.text

    response = locked_client.get("/users/me", auth=("alice", "secret"))
    assert response.status_code == 429, response.text

    response = other_client.get("/users/me", auth=("alice", "secret"))
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "alice"}


def test_failed_attempt_window_expires(monkeypatch) -> None:
    monotonic_now = 100.0
    monkeypatch.setattr("fastapi.security.http.time.monotonic", lambda: monotonic_now)
    security = make_security(max_attempts=1, window_seconds=10)
    client = make_client(security)

    response = client.get("/users/me", auth=("alice", "wrong"))
    assert response.status_code == 401, response.text

    response = client.get("/users/me", auth=("alice", "secret"))
    assert response.status_code == 429, response.text

    monotonic_now = 111.0

    response = client.get("/users/me", auth=("alice", "secret"))
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "alice"}


def test_verify_password_uses_constant_time_comparison(monkeypatch) -> None:
    compare_calls: list[tuple[bytes, bytes]] = []

    def compare_digest(left: bytes, right: bytes) -> bool:
        compare_calls.append((left, right))
        return left == right

    monkeypatch.setattr("fastapi.security.http.secrets.compare_digest", compare_digest)

    assert HTTPBasicWithProtection.verify_password("secret", PASSWORD_HASH)
    assert not HTTPBasicWithProtection.verify_password("wrong", PASSWORD_HASH)
    assert len(compare_calls) == 2


def test_existing_httpbasic_without_verifier_still_returns_credentials() -> None:
    client = make_client(HTTPBasicWithProtection())

    response = client.get("/users/me", auth=("alice", "anything"))

    assert response.status_code == 200, response.text
    assert response.json() == {"username": "alice"}
