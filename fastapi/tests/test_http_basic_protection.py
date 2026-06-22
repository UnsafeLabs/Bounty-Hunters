import time
from fastapi import FastAPI
from fastapi.security.http import HTTPBasicWithProtection
from fastapi.testclient import TestClient

app = FastAPI()
security = HTTPBasicWithProtection(max_attempts=3, window_seconds=60)

@app.get("/secure")
def secure(credentials=security):
    return {"message": "authenticated"}

client = TestClient(app)

class TestHTTPBasicWithProtection:
    def test_valid_credentials(self):
        import base64
        creds = base64.b64encode(b"user:pass").decode()
        resp = client.get("/secure", headers={"Authorization": f"Basic {creds}"})
        assert resp.status_code == 200

    def test_lockout_after_max_attempts(self):
        for _ in range(3):
            resp = client.get("/secure", headers={"Authorization": "Basic invalid"})
        resp = client.get("/secure", headers={"Authorization": "Basic invalid"})
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers

    def test_reset_on_success(self):
        import base64
        client2 = TestClient(app)
        for _ in range(2):
            client2.get("/secure", headers={"Authorization": "Basic invalid"})
        creds = base64.b64encode(b"user:pass").decode()
        resp = client2.get("/secure", headers={"Authorization": f"Basic {creds}"})
        assert resp.status_code == 200

    def test_verify_password_timing_safe(self):
        assert HTTPBasicWithProtection.verify_password("pass123", "pass123")
        assert not HTTPBasicWithProtection.verify_password("wrong", "pass123")
        assert not HTTPBasicWithProtection.verify_password("pass123", None)
