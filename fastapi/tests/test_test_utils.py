import base64
import json

import pytest
from fastapi import Depends, FastAPI, HTTPException, WebSocket
from fastapi.security import HTTPBasic, HTTPBasicCredentials, OAuth2PasswordBearer
from fastapi.security import OAuth2PasswordRequestForm

from fastapi.test_utils import FastAPITestClient, WebSocketTestSession


_fake_users_db: dict[str, dict[str, str]] = {}
_fake_tokens: dict[str, str] = {}


def make_app_with_auth() -> FastAPI:
    global _fake_users_db, _fake_tokens
    _fake_users_db = {}
    _fake_tokens = {}

    app = FastAPI()

    oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")

    @app.post("/register")
    def register(body: dict):
        username = body["username"]
        password = body["password"]
        _fake_users_db[username] = {"username": username, "password": password}
        return {"username": username, "registered": True}

    @app.post("/login")
    def login(form_data: OAuth2PasswordRequestForm = Depends()):
        user = _fake_users_db.get(form_data.username)
        if not user or user["password"] != form_data.password:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        token = f"token-{form_data.username}"
        _fake_tokens[token] = form_data.username
        return {"access_token": token, "token_type": "bearer"}

    def get_current_user(token: str = Depends(oauth2_scheme)):
        username = _fake_tokens.get(token)
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return {"username": username}

    @app.get("/me")
    def read_me(current_user: dict = Depends(get_current_user)):
        return current_user

    @app.get("/public")
    def public():
        return {"msg": "public"}

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await websocket.accept()
        data = await websocket.receive_text()
        await websocket.send_text(f"echo: {data}")
        await websocket.close()

    @app.websocket("/ws/json")
    async def ws_json_endpoint(websocket: WebSocket):
        await websocket.accept()
        data = await websocket.receive_text()
        parsed = json.loads(data)
        parsed["processed"] = True
        await websocket.send_text(json.dumps(parsed))
        await websocket.close()

    @app.websocket("/ws/stream")
    async def ws_stream_endpoint(websocket: WebSocket):
        await websocket.accept()
        for i in range(3):
            data = await websocket.receive_text()
            await websocket.send_text(json.dumps({"index": i, "echo": data}))
        await websocket.close()

    return app


def make_basic_auth_app() -> FastAPI:
    app = FastAPI()
    security = HTTPBasic()

    @app.get("/protected")
    def protected(credentials: HTTPBasicCredentials = Depends(security)):
        return {"username": credentials.username}

    return app


class TestFastAPITestClientBearerAuth:
    def test_set_bearer_token(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        _fake_users_db["alice"] = {"username": "alice", "password": "pw"}
        _fake_tokens["token-alice"] = "alice"
        client.set_bearer_token("token-alice")
        response = client.get("/me")
        assert response.status_code == 200
        assert response.json() == {"username": "alice"}

    def test_clear_auth(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        _fake_users_db["alice"] = {"username": "alice", "password": "pw"}
        _fake_tokens["token-alice"] = "alice"
        client.set_bearer_token("token-alice")
        response = client.get("/me")
        assert response.status_code == 200
        client.clear_auth()
        response = client.get("/me")
        assert response.status_code == 401

    def test_explicit_headers_override_auth(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        _fake_users_db["alice"] = {"username": "alice", "password": "pw"}
        _fake_users_db["bob"] = {"username": "bob", "password": "pw"}
        _fake_tokens["token-alice"] = "alice"
        _fake_tokens["token-bob"] = "bob"
        client.set_bearer_token("token-alice")
        response = client.get("/me", headers={"Authorization": "Bearer token-bob"})
        assert response.status_code == 200
        assert response.json() == {"username": "bob"}

    def test_public_endpoint_no_auth(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        response = client.get("/public")
        assert response.status_code == 200
        assert response.json() == {"msg": "public"}


class TestFastAPITestClientBasicAuth:
    def test_set_basic_auth(self):
        app = make_basic_auth_app()
        client = FastAPITestClient(app)
        client.set_basic_auth("alice", "secret123")
        response = client.get("/protected")
        assert response.status_code == 200
        assert response.json() == {"username": "alice"}

    def test_basic_auth_header_format(self):
        app = make_basic_auth_app()
        client = FastAPITestClient(app)
        client.set_basic_auth("user", "pass")
        expected = base64.b64encode(b"user:pass").decode()
        assert client._auth_headers["Authorization"] == f"Basic {expected}"


class TestFastAPITestClientApiKey:
    def test_set_api_key(self):
        app = FastAPI()

        @app.get("/check")
        def check(x_api_key: str = ""):
            return {"key": x_api_key}

        client = FastAPITestClient(app)
        client.set_api_key("my-secret-key")
        response = client.get("/check")
        assert response.status_code == 200

    def test_set_api_key_custom_header(self):
        app = FastAPI()

        @app.get("/check")
        def check(auth_token: str = ""):
            return {"token": auth_token}

        client = FastAPITestClient(app)
        client.set_api_key("my-token", header_name="Auth-Token")
        response = client.get("/check", headers={"Auth-Token": "my-token"})
        assert response.status_code == 200


class TestFastAPITestClientLogin:
    def test_login_sets_bearer(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        client.post("/register", json={"username": "eve", "password": "pw"})
        token_data = client.login("/login", "eve", "pw")
        assert "access_token" in token_data
        assert client.default_auth_token == token_data["access_token"]
        response = client.get("/me")
        assert response.status_code == 200
        assert response.json() == {"username": "eve"}


class TestFastAPITestClientCreateTestUser:
    def test_create_test_user(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        result = client.create_test_user("/register", username="newuser", password="pw")
        assert result["username"] == "newuser"
        assert result["registered"] is True

    def test_create_test_user_with_extra(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        result = client.create_test_user(
            "/register",
            username="extrauser",
            password="pw",
            extra={"email": "extra@test.com"},
        )
        assert result["username"] == "extrauser"


class TestWebSocketTestSession:
    def test_send_and_receive_text(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        with client.ws_connect("/ws") as ws:
            ws.send_text("hello")
            data = ws.receive_text()
            assert data == "echo: hello"

    def test_send_and_receive_json(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        with client.ws_connect("/ws/json") as ws:
            ws.send_json({"action": "test", "value": 42})
            data = ws.receive_json()
            assert data["action"] == "test"
            assert data["value"] == 42
            assert data["processed"] is True

    def test_wait_for_matches_immediately(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        with client.ws_connect("/ws/stream") as ws:
            ws.send_text("a")
            ws.send_text("b")
            ws.send_text("c")
            msg = ws.wait_for({"index": 0})
            assert msg["index"] == 0
            assert msg["echo"] == "a"

    def test_ws_connect_with_auth_headers(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        client.set_bearer_token("token-alice")
        with client.ws_connect("/ws") as ws:
            ws.send_text("test")
            data = ws.receive_text()
            assert data == "echo: test"


class TestHelperMethods:
    def test_assert_status(self):
        app = FastAPI()

        @app.get("/ok")
        def ok():
            return {"status": "ok"}

        @app.get("/notfound")
        def notfound():
            raise HTTPException(status_code=404, detail="Not found")

        client = FastAPITestClient(app)
        response = client.get("/ok")
        client.assert_status(response, 200)

    def test_assert_status_failure(self):
        app = FastAPI()

        @app.get("/ok")
        def ok():
            return {"status": "ok"}

        client = FastAPITestClient(app)
        response = client.get("/ok")
        with pytest.raises(AssertionError):
            client.assert_status(response, 404)

    def test_assert_json(self):
        app = FastAPI()

        @app.get("/data")
        def data():
            return {"key": "value"}

        client = FastAPITestClient(app)
        response = client.get("/data")
        client.assert_json(response, {"key": "value"})

    def test_assert_json_failure(self):
        app = FastAPI()

        @app.get("/data")
        def data():
            return {"key": "other"}

        client = FastAPITestClient(app)
        response = client.get("/data")
        with pytest.raises(AssertionError):
            client.assert_json(response, {"key": "value"})


class TestSetAuthHeaders:
    def test_custom_auth_headers(self):
        app = FastAPI()

        @app.get("/check")
        def check():
            return {"ok": True}

        client = FastAPITestClient(app)
        client.set_auth_headers({"X-Custom-Auth": "custom-value"})
        response = client.get("/check")
        assert response.status_code == 200
        assert "X-Custom-Auth" in client._auth_headers

    def test_all_http_methods_include_auth(self):
        app = FastAPI()

        @app.api_route("/test", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
        def test_endpoint():
            return {"ok": True}

        client = FastAPITestClient(app)
        client.set_bearer_token("test-token")

        for method_call in ["get", "post", "put", "patch", "delete", "head", "options"]:
            response = getattr(client, method_call)("/test")
            assert response.status_code == 200


class TestWebSocketTestSessionContext:
    def test_context_manager_closes(self):
        app = make_app_with_auth()
        client = FastAPITestClient(app)
        with client.ws_connect("/ws") as ws:
            ws.send_text("bye")
            ws.receive_text()
