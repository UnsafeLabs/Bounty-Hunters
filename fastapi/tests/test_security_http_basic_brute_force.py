from fastapi import FastAPI, Security
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.testclient import TestClient

app = FastAPI()

# Use a low threshold for testing
security = HTTPBasic(max_failed_attempts=3, lockout_duration_seconds=60)


@app.get("/users/me")
def read_current_user(credentials: HTTPBasicCredentials = Security(security)):
    return {"username": credentials.username, "password": credentials.password}


client = TestClient(app)


def test_brute_force_lockout_after_failures():
    """Test that after exceeding max_failed_attempts the IP gets locked out."""
    # Send 3 invalid requests to trigger lockout
    for i in range(3):
        response = client.get(
            "/users/me",
            headers={"Authorization": "Basic invalidcredential"},
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"

    # The 4th request should be blocked with 429
    response = client.get(
        "/users/me",
        headers={"Authorization": "Basic invalidcredential"},
    )
    assert response.status_code == 429, f"Expected 429, got {response.status_code}"
    assert response.json() == {"detail": "Too many failed authentication attempts. Try again later."}
    assert "Retry-After" in response.headers


def test_brute_force_lockout_cleared_on_success():
    """Test that a successful auth clears the failed attempt counter."""
    # Reset by creating a fresh instance
    local_security = HTTPBasic(max_failed_attempts=2, lockout_duration_seconds=60)

    local_app = FastAPI()

    @local_app.get("/users/me")
    def local_user(credentials: HTTPBasicCredentials = Security(local_security)):
        return {"username": credentials.username, "password": credentials.password}

    local_client = TestClient(local_app)

    # Send one bad request
    response = local_client.get(
        "/users/me",
        headers={"Authorization": "Basic invalidcredential"},
    )
    assert response.status_code == 401

    # Send a valid request
    response = local_client.get("/users/me", auth=("john", "secret"))
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "john", "password": "secret"}

    # Failed attempts should now be cleared, so another bad request should still
    # return 401 (not 429) since the counter was reset
    response = local_client.get(
        "/users/me",
        headers={"Authorization": "Basic invalidcredential"},
    )
    assert response.status_code == 401, f"Expected 401 after success, got {response.status_code}"
    # After this bad request, we should have 1 failure, need one more to lockout
    response = local_client.get(
        "/users/me",
        headers={"Authorization": "Basic invalidcredential"},
    )
    assert response.status_code == 401
    # Now the 3rd bad request should lockout
    response = local_client.get(
        "/users/me",
        headers={"Authorization": "Basic invalidcredential"},
    )
    assert response.status_code == 429, f"Expected 429 after 2 failures, got {response.status_code}"
