from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION


async def http_exception_handler(request: Request, exc: HTTPException) -> Response:
    headers = getattr(exc, "headers", None)
    if not is_body_allowed_for_status_code(exc.status_code):
        return Response(status_code=exc.status_code, headers=headers)
    return JSONResponse(
        {"detail": exc.detail}, status_code=exc.status_code, headers=headers
    )


def _redact_body(data):
    if isinstance(data, dict):
        redacted = {}
        for k, v in data.items():
            if str(k).lower() in {"password", "secret", "token", "api_key"}:
                redacted[k] = "***REDACTED***"
            else:
                redacted[k] = _redact_body(v)
        return redacted
    elif isinstance(data, list):
        return [_redact_body(item) for item in data]
    return data


async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    content = {
        "detail": jsonable_encoder(exc.errors()),
        "path": request.url.path,
        "method": request.method,
    }
    app = getattr(request, "app", None)
    if app and getattr(app, "debug", False):
        body = None
        try:
            body_bytes = await request.body()
            if body_bytes:
                import json
                try:
                    body_json = json.loads(body_bytes)
                    body = _redact_body(body_json)
                except json.JSONDecodeError:
                    body = body_bytes.decode("utf-8", errors="ignore")
        except Exception:
            pass
        content["body"] = body

    return JSONResponse(
        status_code=422,
        content=content,
    )



async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )
