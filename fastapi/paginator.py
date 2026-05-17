"""Paginator with offset and cursor-based pagination"""
from typing import TypeVar, Generic, Optional, List
from pydantic import BaseModel
import base64, json

ItemType = TypeVar("ItemType")

class PaginatedResponse(BaseModel, Generic[ItemType]):
    items: List[ItemType]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool
    next_cursor: Optional[str] = None
    previous_cursor: Optional[str] = None

class Paginator(Generic[ItemType]):
    def __init__(self, items: List[ItemType], total: int, page: int = 1, page_size: int = 20):
        self.items = items
        self.total = max(0, total)
        self.page = max(1, page)
        self.page_size = max(1, page_size)
        self.total_pages = max(1, (self.total + self.page_size - 1) // self.page_size) if self.total > 0 else 1

    def offset_paginate(self) -> PaginatedResponse[ItemType]:
        start = (self.page - 1) * self.page_size
        end = start + self.page_size
        page_items = self.items[start:end]
        return PaginatedResponse(
            items=page_items, total=self.total, page=self.page, page_size=self.page_size,
            total_pages=self.total_pages,
            has_next=self.page < self.total_pages,
            has_previous=self.page > 1,
        )

    def cursor_paginate(self, cursor_field: str = "id", cursor: Optional[str] = None) -> PaginatedResponse[ItemType]:
        sorted_items = sorted(self.items, key=lambda x: getattr(x, cursor_field, 0))
        if cursor:
            try:
                cursor_val = json.loads(base64.b64decode(cursor).decode())
                sorted_items = [i for i in sorted_items if getattr(i, cursor_field, 0) > cursor_val.get("last_id", 0)]
            except: pass
        page_items = sorted_items[:self.page_size]
        next_cursor = None
        if len(sorted_items) > self.page_size:
            last_id = getattr(page_items[-1], cursor_field, 0) if page_items else 0
            next_cursor = base64.b64encode(json.dumps({"last_id": last_id}).encode()).decode()
        previous_cursor = cursor if cursor else None
        return PaginatedResponse(
            items=page_items, total=self.total, page=1, page_size=self.page_size,
            total_pages=self.total_pages,
            has_next=len(sorted_items) > self.page_size,
            has_previous=cursor is not None,
            next_cursor=next_cursor, previous_cursor=previous_cursor,
        )

    async def iter_all(self) -> List[ItemType]:
        return self.items[:self.total]
