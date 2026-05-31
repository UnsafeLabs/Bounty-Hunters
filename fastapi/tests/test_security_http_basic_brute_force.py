import time
from base64 import b64encode
from unittest.mock import patch

from fastapi import FastAPI, Security
from fastapi.security import BruteForceProtector, HTTPBasic, HTTPBasicCredentials
from fastapi.testclient import TestClient


class TestBruteForceProtector:
    def test_no_lockout_initially(self):
        protector = BruteForceProtector(max_attempts=3)
        assert protector.check("127.0.0.1") is None

    def test_lockout_after_max_attempts(self):
        protector = BruteForceProtector(max_attempts=3, base_lockout_seconds=10)
        for _ in range(3):
            protector.record_failure("127.0.0.1")
        exc = protector.check("127.0.0.1")
        assert exc is not None
        assert exc.status_code == 429
        assert "Retry-After" in exc.headers

    def test_success_resets_counter(self):
        protector = BruteForceProtector(max_attempts=3, base_lockout_seconds=10)
        protector.record_failure("127.0.0.1")
        protector.record_failure("127.0.0.1")
        protector.record_success("127.0.0.1")
        for _ in range(2):
            protector.record_failure("127.0.0.1")
        assert protector.check("127.0.0.1") is None

    def test_exponential_backoff(self):
        now = time.monotonic()
        protector = BruteForceProtector(
            max_attempts=2, base_lockout_seconds=30, max_lockout_seconds=3600
        )
        with patch("fastapi.security.brute_force.time.monotonic", return_value=now):
            protector.record_failure("127.0.0.1")
            protector.record_failure("127.0.0.1")
        assert protector._lockout_level["127.0.0.1"] == 1
        assert protector._lockout_until["127.0.0.1"] == now + 30

        with patch("fastapi.security.brute_force.time.monotonic", return_value=now + 31):
            protector.record_failure("127.0.0.1")
            protector.record_failure("127.0.0.1")
        assert protector._lockout_level["127.0.0.1"] == 2
        assert protector._lockout_until["127.0.0.1"] == now + 31 + 60

    def test_max_lockout_cap(self):
        protector = BruteForceProtector(
            max_attempts=1, base_lockout_seconds=30, max_lockout_seconds=120
        )
        now = time.monotonic()
        with patch("fastapi.security.brute_force.time.monotonic", return_value=now):
            for _ in range(4):
                protector.record_failure("127.0.0.1")
                with patch("fastapi.security.brute_force.time.monotonic", return_value=now + 121):
                    protector.check("127.0.0.1")
        last_level = protector._lockout_level.get("127.0.0.1", 0)
        last_lockout = protector.base_lockout_seconds * (2 ** (last_level - 1))
        assert min(last_lockout, protector.max_lockout_seconds) <= protector.max_lockout_seconds

    def test_separate_keys_independent(self):
        protector = BruteForceProtector(max_attempts=2, base_lockout_seconds=10)
        protector.record_failure("1.1.1.1")
        protector.record_failure("1.1.1.1")
        assert protector.check("1.1.1.1") is not None
        assert protector.check("2.2.2.2") is None

    def test_record_failure_during_lockout_ignored(self):
        protector = BruteForceProtector(max_attempts=1, base_lockout_seconds=60)
        protector.record_failure("127.0.0.1")
        level_before = protector._lockout_level.get("127.0.0.1", 0)
        protector.record_failure("127.0.0.1")
        level_after = protector._lockout_level.get("127.0.0.1", 0)
        assert level_before == level_after

    def test_invalid_max_attempts(self):
        try:
            BruteForceProtector(max_attempts=0)
            assert False, "Should have raised ValueError"
        except ValueError:
            pass

    def test_invalid_base_lockout(self):
        try:
            BruteForceProtector(base_lockout_seconds=0)
            assert False, "Should have raised ValueError"
        except ValueError:
            pass

    def test_invalid_max_lockout(self):
        try:
            BruteForceProtector(base_lockout_seconds=30, max_lockout_seconds=10)
            assert False, "Should have raised ValueError"
        except ValueError:
            pass


class TestHTTPBasicBruteForce:
    def setup_method(self):
        self.protector = BruteForceProtector(
            max_attempts=3, base_lockout_seconds=30
        )
        self.app = FastAPI()
        self.security = HTTPBasic(brute_force_protector=self.protector)

        @self.app.get("/users/me")
        def read_current_user(
            credentials: HTTPBasicCredentials = Security(self.security),
        ):
            return {"username": credentials.username}

        self.client = TestClient(self.app)

    def test_successful_login(self):
        response = self.client.get("/users/me", auth=("john", "secret"))
        assert response.status_code == 200
        assert response.json() == {"username": "john"}

    def test_failed_login_returns_401(self):
        response = self.client.get(
            "/users/me", headers={"Authorization": "Basic notabase64token"}
        )
        assert response.status_code == 401

    def test_lockout_after_repeated_failures(self):
        for _ in range(3):
            self.client.get(
                "/users/me", headers={"Authorization": "Basic invalid"}
            )
        response = self.client.get("/users/me", auth=("john", "secret"))
        assert response.status_code == 429
        assert "retry-after" in response.headers

    def test_lockout_returns_correct_headers(self):
        for _ in range(3):
            self.client.get(
                "/users/me", headers={"Authorization": "Basic invalid"}
            )
        response = self.client.get("/users/me", auth=("john", "secret"))
        assert response.status_code == 429
        assert "retry-after" in response.headers
        retry_after = int(response.headers["retry-after"])
        assert retry_after > 0

    def test_no_lockout_without_protector(self):
        app = FastAPI()
        security = HTTPBasic()

        @app.get("/users/me")
        def read_current_user(
            credentials: HTTPBasicCredentials = Security(security),
        ):
            return {"username": credentials.username}

        client = TestClient(app)
        for _ in range(10):
            client.get("/users/me", headers={"Authorization": "Basic invalid"})
        response = client.get("/users/me", headers={"Authorization": "Basic invalid"})
        assert response.status_code == 401

    def test_success_resets_brute_force_counter(self):
        for _ in range(2):
            self.client.get(
                "/users/me", headers={"Authorization": "Basic invalid"}
            )
        self.client.get("/users/me", auth=("john", "secret"))
        for _ in range(2):
            self.client.get(
                "/users/me", headers={"Authorization": "Basic invalid"}
            )
        response = self.client.get("/users/me", auth=("john", "secret"))
        assert response.status_code == 200

    def test_no_credentials_counts_as_failure(self):
        for _ in range(3):
            self.client.get("/users/me")
        response = self.client.get("/users/me", auth=("john", "secret"))
        assert response.status_code == 429
