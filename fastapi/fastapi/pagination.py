import base64
import json
from typing import Any, Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")

class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated response model."""
    items: List[T]
    total: int
    page: Optional[int] = None
    page_size: int
    total_pages: Optional[int] = None
    has_next: bool
    has_previous: bool
    next_cursor: Optional[str] = None
    prev_cursor: Optional[str] = None

class Paginator:
    @staticmethod
    def paginate_offset(
        items: List[T],
        page: int,
        page_size: int,
        total_count: int
    ) -> PaginatedResponse[T]:
        page = max(1, page)
        total_pages = (total_count + page_size - 1) // page_size if page_size > 0 else 0
        
        return PaginatedResponse(
            items=items,
            total=total_count,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
            has_next=page < total_pages,
            has_previous=page > 1
        )

    @staticmethod
    def encode_cursor(cursor_data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(cursor_data).encode()).decode()

    @staticmethod
    def decode_cursor(cursor_str: str) -> dict:
        try:
            return json.loads(base64.urlsafe_b64decode(cursor_str).decode())
        except Exception:
            return {}

    @staticmethod
    def paginate_cursor(
        items: List[T],
        page_size: int,
        next_id: Optional[Any] = None,
        prev_id: Optional[Any] = None
    ) -> PaginatedResponse[T]:
        return PaginatedResponse(
            items=items,
            total=len(items), # Cursor-based often doesn't return total
            page_size=page_size,
            has_next=next_id is not None,
            has_previous=prev_id is not None,
            next_cursor=Paginator.encode_cursor({"id": next_id}) if next_id else None,
            prev_cursor=Paginator.encode_cursor({"id": prev_id}) if prev_id else None
        )
