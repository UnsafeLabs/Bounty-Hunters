"""Paginator with offset and cursor-based pagination"""
from typing import Generic, TypeVar, List, Optional, AsyncIterator

T = TypeVar("T")

class PaginatedResponse(Generic[T]):
    def __init__(self, items: List[T], total: int, offset: int, limit: int):
        self.items = items
        self.total = total
        self.offset = offset
        self.limit = limit

    @property
    def has_next(self) -> bool:
        return self.offset + self.limit < self.total

    @property
    def has_previous(self) -> bool:
        return self.offset > 0

    @property
    def next_offset(self) -> Optional[int]:
        return self.offset + self.limit if self.has_next else None

    @property
    def previous_offset(self) -> Optional[int]:
        return max(0, self.offset - self.limit) if self.has_previous else None


class Paginator(Generic[T]):
    def __init__(self, query, offset: int = 0, limit: int = 20):
        self.query = query
        self.offset = max(0, offset)
        self.limit = max(1, min(limit, 100))

    async def fetch_page(self, offset: int = None, limit: int = None) -> PaginatedResponse[T]:
        off = offset if offset is not None else self.offset
        lim = limit if limit is not None else self.limit
        total = await self.query.count()
        items = await self.query.offset(off).limit(lim).all()
        return PaginatedResponse(items=items, total=total, offset=off, limit=lim)

    async def get_next(self) -> Optional[PaginatedResponse[T]]:
        next_off = self.offset + self.limit
        total = await self.query.count()
        if next_off >= total:
            return None
        return await self.fetch_page(next_off, self.limit)

    async def get_previous(self) -> Optional[PaginatedResponse[T]]:
        prev_off = max(0, self.offset - self.limit)
        if prev_off == self.offset:
            return None
        return await self.fetch_page(prev_off, self.limit)

    async def iter_all(self) -> AsyncIterator[List[T]]:
        """Async iteration over all pages. Usage: async for page in paginator.iter_all():"""
        while True:
            page = await self.fetch_page()
            if not page.items:
                break
            yield page.items
            self.offset += self.limit

    async def count(self) -> int:
        return await self.query.count()
