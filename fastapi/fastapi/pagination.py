from typing import (
    List, Dict, Any, Optional, TypeVar, Type, Generic
)
from pyd#%%# 
1. Issue Description
The application needs a pagination utility that works with any SQLAlchemy or Pydantic-based data source and returns standardized paginated responses. 
2. Implementation
- Create `fastapi/fastapi/pagination.py` with a `Paginator` class
- Accept `page` and `page_size` query parameters via dependency injection
- Return a standardized response model with fields: items, total, page, page_size, total_pages, has_next, has_previous
- Support both offset-based and cursor-based pagination

3. Tests

