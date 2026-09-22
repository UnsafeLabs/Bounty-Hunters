# -*- coding: utf-8 -*-
"""
FastAPI package public interface.

We re‑export the newly added OAuth2 utilities so that users can import them
directly from ``fastapi.security`` or from the top‑level package as needed.
"""

# Existing imports (truncated for brevity)
from .applications import FastAPI
from .routing import APIRouter
# ... other public symbols ...

# New OAuth2 helpers
from .security.oauth2 import (
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
)

__all__ = [
    # Existing public symbols (truncated)
    "FastAPI",
    "APIRouter",
    # New symbols
    "OAuth2PasswordBearerWithRefresh",
    "OAuth2RefreshRequestForm",
]
