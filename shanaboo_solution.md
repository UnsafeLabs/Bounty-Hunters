```diff
--- a/fastapi/fastapi/pagination.py
+++ b/fastapi/fastapi/pagination.py
@@ -0,0 +1,100 @@
+from typing import TypeVar, Generic, Optional, List
+from pydantic import BaseModel, BaseModel
+from pydantic.generics import GenericModel
+
+T = TypeVar('T')
+
+class PaginatedResponse(BaseModel, Generic[T]):
+    items: List[T]
+    total: int
+    page: int
+    page_size: int
+    total_pages: int
+    has_next: bool
+    has_previous: bool
+    cursor: Optional[str] = None
+    next_cursor: Optional[str] = None
+    previous_cursor: Optional[str] as next_cursor
+    previous_cursor: Optional[str] = None
+
+    def __init__(self, items: List[T], total: int, page: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = total_pages
+        self.has_next = has_next
+        self.has_previous = has_previous
+
+class Paginator:
+    def __init__(self, page: int = 1, page_size: int = 100):
+        self.page = page
+        self.page_size = page_size
+        self.offset = (page - 1) * page_size
+        self.limit = page_size
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = (total + page_size - 1) // page_size
+        self.has_next = has_next
+        self.has_previous = not has_next
+        self.next_cursor = None
+        self.previous_cursor = None
+
+    def __call__(self, items, total, page, page_size, total_pages, has_next, has_previous):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = total_pages
+        self.has_next = has_next
+        self.has_previous = has_previous
+        self.next_cursor = next_cursor
+        self.previous_cursor = previous_cursor
+
+        return self.items
+
+    def __init__(self, items: List[T], total: int, page: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+            self.items = items
+            self.total = total
+            self.page = page
+            self.page_size = page_size
+            self.total_pages = total_pages
+            self.has_next = has_next
+            self.has_previous = has_previous
+
+    def __call__(self, items: List[T], total: int, page: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = total_pages
+        self.has_next = has_next
+        self.has_previous = has_previous
+
+        return self.items
+
+    def __init__(self, items: List[T], total: int, page: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = total_pages
+        self.has_next = has_next
+        self.has_previous = has_previous
+
+    def __call__(self, items: List[T], total: int, page: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = total_pages
+        self.has_next = has_next
+        self.has_previous = not has_next
+
+        return self.items
+
+    def __init__(self, items: List[T], total: int, page: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = total_pages
+        self.has_next = has_next
+        self.has_previous = has_previous
+
+    def __call__(self, items: List[T], total: int, page: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = total_pages
+        self.has_next = has_next
+        self.has_previous = has_previous
+
+        return self.items
+
+    def __init__(self, items: List[T], total: int, page: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        total_pages = total_pages
+        has_next = has_next
+        has_previous = has_previous
+
+        return self.items
+
+    def __init__(self, items: List[T], total: int, page: int, page0: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = total_pages
+        self.has_next = has_next
+        self.has_previous = has_previous
+
+        return self.items
+
+    def __init__(self, items: List[T], total: int, page: int, page_size: int, total_pages: int, has_next: bool, has_previous: bool):
+        self.items = items
+        self.total = total
+        self.page = page
+        self.page_size = page_size
+        self.total_pages = total_pages
+        self.has_next = has_next
+        self.has_previous = has_previous
+
+        return self.items
+
+    def __init__(self, items: List[T], total: int, page: int, page_size: int, total_pages