"""Tests for OAuth2PasswordBearerWithRefresh and OAuth2RefreshRequestForm."""
from fastapi import FastAPI
from fastapi.security import OAuth2PasswordBearerWithRefresh, OAuth2RefreshRequestForm
from fastapi.testclient import TestClient


def test_oauth2_bearer_with_refresh():
    """OAuth2PasswordBearerWithRefresh accepts refresh_url parameter."""
    scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token",
        refresh_url="/token/refresh",
    )
    assert scheme.refresh_url == "/token/refresh"
    assert scheme.model.flows.password.tokenUrl == "/token"
    assert scheme.model.flows.password.refreshUrl == "/token/refresh"


def test_oauth2_bearer_with_refresh_scheme_name():
    """scheme_name defaults to class name."""
    scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token",
        refresh_url="/token/refresh",
    )
    assert scheme.scheme_name == "OAuth2PasswordBearerWithRefresh"


def test_oauth2_refresh_request_form():
    """OAuth2RefreshRequestForm stores its fields."""
    form = OAuth2RefreshRequestForm(
        grant_type="refresh_token",
        refresh_token="abc123",
    )
    assert form.grant_type == "refresh_token"
    assert form.refresh_token == "abc123"
    assert form.scopes == []


def test_oauth2_refresh_request_form_with_scopes():
    """Scopes are split on whitespace."""
    form = OAuth2RefreshRequestForm(
        grant_type="refresh_token",
        refresh_token="abc123",
        scope="read write",
    )
    assert form.scopes == ["read", "write"]


def test_oauth2_refresh_request_form_client_credentials():
    """Client credentials are stored."""
    form = OAuth2RefreshRequestForm(
        grant_type="refresh_token",
        refresh_token="abc123",
        client_id="myclient",
        client_secret="secret123",
    )
    assert form.client_id == "myclient"
    assert form.client_secret == "secret123"
