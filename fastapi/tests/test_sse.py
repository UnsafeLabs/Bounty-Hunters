"""Tests for SSE disconnect detection, event filtering, and reconnection."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import EventSourceResponse
from fastapi.sse import ServerSentEvent, get_last_event_id
from fastapi.testclient import TestClient
from starlette.responses import StreamingResponse


def test_event_source_response_params():
    """EventSourceResponse constructor accepts optional params."""
    async def on_dc():
        pass
    async def ev_filter(item):
        return True

    resp = EventSourceResponse(
        content=None,
        on_disconnect=on_dc,
        event_filter=ev_filter,
    )
    assert resp.on_disconnect is on_dc
    assert resp.event_filter is ev_filter


def test_get_last_event_id_none():
    """get_last_event_id returns None when header is absent."""
    scope = {"headers": [(b"host", b"example.com")]}
    request = Request(scope)
    assert get_last_event_id(request) is None


def test_get_last_event_id_present():
    """get_last_event_id reads Last-Event-ID header."""
    scope = {"headers": [(b"last-event-id", b"42"), (b"host", b"example.com")]}
    request = Request(scope)
    assert get_last_event_id(request) == "42"


def test_event_source_is_streaming_response():
    """EventSourceResponse is a subclass of StreamingResponse."""
    assert issubclass(EventSourceResponse, StreamingResponse)


def test_default_params_none():
    """By default on_disconnect and event_filter are None."""
    resp = EventSourceResponse()
    assert resp.on_disconnect is None
    assert resp.event_filter is None
