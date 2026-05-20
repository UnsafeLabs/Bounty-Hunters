import asyncio
import base64
import threading
import unittest
from dataclasses import dataclass

from fastapi.exceptions import HTTPException
from fastapi.security.http import HTTPBasicCredentials, HTTPBasicWithProtection


@dataclass
class Client:
    host: str


class Request:
    def __init__(self, authorization: str = "", host: str = "127.0.0.1"):
        self.headers: dict[str, str] = {}
        if authorization:
            self.headers["Authorization"] = authorization
        self.client = Client(host)


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def basic(username: str, password: str) -> str:
    payload = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {payload}"


class HTTPBasicWithProtectionTest(unittest.TestCase):
    def run_async(self, awaitable):
        return asyncio.run(awaitable)

    def test_successful_authentication_returns_credentials(self):
        security = HTTPBasicWithProtection(
            password_checker=lambda credentials: credentials.password == "correct"
        )

        credentials = self.run_async(security(Request(basic("alice", "correct"))))

        self.assertEqual(
            credentials,
            HTTPBasicCredentials(username="alice", password="correct"),
        )

    def test_failed_attempts_are_tracked_per_ip_and_locked_out(self):
        clock = Clock()
        security = HTTPBasicWithProtection(
            max_attempts=2,
            window_seconds=60,
            password_checker=lambda credentials: False,
            time_source=clock,
        )

        for _ in range(2):
            with self.assertRaises(HTTPException) as raised:
                self.run_async(
                    security(Request(basic("alice", "wrong"), host="10.0.0.1"))
                )
            self.assertEqual(raised.exception.status_code, 401)

        with self.assertRaises(HTTPException) as raised:
            self.run_async(security(Request(basic("alice", "wrong"), host="10.0.0.1")))

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.headers["Retry-After"], "60")

    def test_failed_attempts_do_not_leak_between_ips(self):
        security = HTTPBasicWithProtection(
            max_attempts=1,
            password_checker=lambda credentials: credentials.password == "good",
        )

        with self.assertRaises(HTTPException):
            self.run_async(security(Request(basic("alice", "bad"), host="10.0.0.1")))

        credentials = self.run_async(
            security(Request(basic("alice", "good"), host="10.0.0.2"))
        )

        self.assertEqual(credentials.username, "alice")

    def test_successful_authentication_resets_attempt_counter(self):
        security = HTTPBasicWithProtection(
            max_attempts=2,
            password_checker=lambda credentials: credentials.password == "good",
        )

        with self.assertRaises(HTTPException):
            self.run_async(security(Request(basic("alice", "bad"))))

        self.run_async(security(Request(basic("alice", "good"))))

        with self.assertRaises(HTTPException) as raised:
            self.run_async(security(Request(basic("alice", "bad"))))
        self.assertEqual(raised.exception.status_code, 401)

    def test_lockout_window_expiry_allows_new_attempts(self):
        clock = Clock()
        security = HTTPBasicWithProtection(
            max_attempts=1,
            window_seconds=30,
            password_checker=lambda credentials: False,
            time_source=clock,
        )

        with self.assertRaises(HTTPException):
            self.run_async(security(Request(basic("alice", "bad"))))

        with self.assertRaises(HTTPException) as locked:
            self.run_async(security(Request(basic("alice", "bad"))))
        self.assertEqual(locked.exception.status_code, 429)

        clock.advance(30)

        with self.assertRaises(HTTPException) as fresh_failure:
            self.run_async(security(Request(basic("alice", "bad"))))
        self.assertEqual(fresh_failure.exception.status_code, 401)

    def test_password_hash_verification_uses_constant_time_digest_check(self):
        password_hash = HTTPBasicWithProtection.hash_password(
            "s3cret",
            salt=b"fixed-test-salt!",
            iterations=1_000,
        )

        self.assertTrue(HTTPBasicWithProtection.verify_password("s3cret", password_hash))
        self.assertFalse(HTTPBasicWithProtection.verify_password("wrong", password_hash))
        self.assertFalse(HTTPBasicWithProtection.verify_password("s3cret", "invalid"))

    def test_failed_attempt_tracking_is_thread_safe(self):
        security = HTTPBasicWithProtection(max_attempts=100)

        def fail() -> None:
            security._record_failure("10.0.0.1")

        threads = [threading.Thread(target=fail) for _ in range(50)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(security._failed_attempts["10.0.0.1"][0], 50)

    def test_optional_http_basic_behavior_is_preserved(self):
        security = HTTPBasicWithProtection(auto_error=False)

        self.assertIsNone(self.run_async(security(Request())))


if __name__ == "__main__":
    unittest.main()
