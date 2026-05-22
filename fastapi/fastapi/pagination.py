import math, base64, json
from typing import Generic, Optional, TypeVar
from .param_functions import Query
from pydantic import BaseModel

T = TypeVar("T")

class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool

class Paginator:
    def __init__(self, total: int, page: int = 1, page_size: int = 20):
        self.total = total
        self.page = max(page, 1)
        self.page_size = max(page_size, 1)
        self.total_pages = max(math.ceil(total / self.page_size), 1)
        if self.page > self.total_pages:
            self.page = self.total_pages
        self.offset = (self.page - 1) * self.page_size
        self.has_next = self.page < self.total_pages
        self.has_previous = self.page > 1

    def response(self, items: list[T]) -> PaginatedResponse[T]:
        return PaginatedResponse(
            items=items, total=self.total, page=self.page,
            page_size=self.page_size, total_pages=self.total_pages,
            has_next=self.has_next, has_previous=self.has_previous,
        )

def encode_cursor(item_id: str) -> str:
    return base64.urlsafe_b64encode(
        json.dumps({"id": item_id}).encode()
    ).rstrip(b"=").decode()

def decode_cursor(token: str) -> Optional[str]:
    try:
        pad = token + "=" * (4 - len(token) % 4)
        return json.loads(base64.urlsafe_b64decode(pad))["id"]
    except Exception:
        return None

def cursor_page(items: list, page_size: int, after: str = None):
    start = 0
    if after:
        cid = decode_cursor(after)
        if cid:
            for i, item in enumerate(items):
                if str(getattr(item, "id", item)) == cid:
                    start = i + 1
                    break
    chunk = items[start:start + page_size]
    next_c = encode_cursor(str(getattr(chunk[-1], "id", chunk[-1]))) \
             if start + page_size < len(items) else None
    return chunk, next_c

async def paginate(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> tuple[int, int]:
    return page, page_size
