from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION

SENSITIVE_FIELDS = {"password", "secret", "token", "api_key"}


def _redact_sensitive(body):
    if isinstance(body, dict):
        return {
            key: ("***REDACTED***" if key.lower() in SENSITIVE_FIELDS else _redact_sensitive(value))
            for key, value in body.items()
        }
    if isinstance(body, list):
        return [_redact_sensitive(item) for item in body]
    return body


async def http_exception_handler(request: Request, exc: HTTPException) -> Response:
    headers = getattr(exc, "headers", None)
    if not is_body_allowed_for_status_code(exc.status_code):
        return Response(status_code=exc.status_code, headers=headers)
    return JSONResponse(
        {"detail": exc.detail}, status_code=exc.status_code, headers=headers
    )


async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    response_data = {
        "detail": jsonable_encoder(exc.errors()),
        "path": request.url.path,
        "method": request.method,
    }
    if request.app.debug:
        try:
            body_bytes = await request.body()
            if body_bytes:
                import json

                raw_body = json.loads(body_bytes)
                response_data["body"] = _redact_sensitive(raw_body)
        except Exception:
            response_data["body"] = None
    return JSONResponse(status_code=422, content=response_data)


async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )