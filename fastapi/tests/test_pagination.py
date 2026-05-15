from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.pagination import PaginatedResponse, Paginator, paginate
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, create_engine, select
from sqlalchemy.orm import Session, declarative_base


class Item(BaseModel):
    id: int
    name: str


ITEMS = [Item(id=index, name=f"item-{index}") for index in range(1, 8)]

app = FastAPI()


@app.get("/items", response_model=PaginatedResponse[Item])
def read_items(paginator: Annotated[Paginator, Depends(paginate)]):
    return paginator.paginate(ITEMS)


@app.get("/cursor-items", response_model=PaginatedResponse[Item])
def read_cursor_items(paginator: Annotated[Paginator, Depends(paginate)]):
    return paginator.paginate(ITEMS, mode="cursor")


@app.get("/empty", response_model=PaginatedResponse[Item])
def read_empty(paginator: Annotated[Paginator, Depends(paginate)]):
    return paginator.paginate([])


client = TestClient(app)


class FakeQuery:
    def __init__(
        self, items: list[Item], offset_value: int = 0, limit_value: int | None = None
    ) -> None:
        self.items = items
        self.offset_value = offset_value
        self.limit_value = limit_value

    def count(self) -> int:
        return len(self.items)

    def offset(self, value: int) -> "FakeQuery":
        return FakeQuery(self.items, offset_value=value, limit_value=self.limit_value)

    def limit(self, value: int) -> "FakeQuery":
        return FakeQuery(self.items, offset_value=self.offset_value, limit_value=value)

    def all(self) -> list[Item]:
        end = None
        if self.limit_value is not None:
            end = self.offset_value + self.limit_value
        return self.items[self.offset_value : end]


Base = declarative_base()


class DbItem(Base):
    __tablename__ = "pagination_test_items"

    id = Column(Integer, primary_key=True)
    name = Column(String)


def test_offset_pagination_calculates_skip_limit_and_totals():
    response = client.get("/items?page=2&page_size=3")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [
            {"id": 4, "name": "item-4"},
            {"id": 5, "name": "item-5"},
            {"id": 6, "name": "item-6"},
        ],
        "total": 7,
        "page": 2,
        "page_size": 3,
        "total_pages": 3,
        "has_next": True,
        "has_previous": True,
        "next_cursor": None,
        "previous_cursor": None,
    }


def test_offset_pagination_handles_last_page_boundary():
    response = client.get("/items?page=3&page_size=3")

    assert response.status_code == 200, response.text
    assert response.json()["has_next"] is False
    assert response.json()["has_previous"] is True
    assert response.json()["items"] == [{"id": 7, "name": "item-7"}]


def test_paginate_dependency_rejects_invalid_query_values():
    assert client.get("/items?page=0").status_code == 422
    assert client.get("/items?page=-1").status_code == 422
    assert client.get("/items?page_size=0").status_code == 422


def test_empty_results_have_zero_totals_and_no_boundaries():
    response = client.get("/empty?page=1&page_size=10")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 10,
        "total_pages": 0,
        "has_next": False,
        "has_previous": False,
        "next_cursor": None,
        "previous_cursor": None,
    }


def test_cursor_pagination_uses_encoded_next_and_previous_cursors():
    first = client.get("/cursor-items?page_size=3")

    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert [item["id"] for item in first_payload["items"]] == [1, 2, 3]
    assert first_payload["has_next"] is True
    assert first_payload["has_previous"] is False
    assert first_payload["next_cursor"] is not None
    assert first_payload["previous_cursor"] is None
    assert Paginator.decode_cursor(first_payload["next_cursor"]) == 3

    second = client.get(
        f"/cursor-items?page_size=3&cursor={first_payload['next_cursor']}"
    )

    assert second.status_code == 200, second.text
    second_payload = second.json()
    assert [item["id"] for item in second_payload["items"]] == [4, 5, 6]
    assert second_payload["page"] == 2
    assert second_payload["has_next"] is True
    assert second_payload["has_previous"] is True
    assert Paginator.decode_cursor(second_payload["next_cursor"]) == 6
    assert Paginator.decode_cursor(second_payload["previous_cursor"]) == 0


def test_cursor_pagination_handles_final_page_boundary():
    cursor = Paginator.encode_cursor(6)
    response = client.get(f"/cursor-items?page_size=3&cursor={cursor}")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["items"] == [{"id": 7, "name": "item-7"}]
    assert payload["has_next"] is False
    assert payload["has_previous"] is True
    assert payload["next_cursor"] is None
    assert Paginator.decode_cursor(payload["previous_cursor"]) == 3


def test_invalid_cursor_returns_validation_error():
    response = client.get("/cursor-items?page_size=3&cursor=not-a-real-cursor")

    assert response.status_code == 422
    assert response.json()["detail"] == "cursor must be a valid encoded pagination cursor"


def test_direct_paginator_validation_handles_invalid_edges():
    with pytest.raises(ValueError, match="page must be greater"):
        Paginator(page=0)
    with pytest.raises(ValueError, match="page_size must be greater"):
        Paginator(page_size=0)
    with pytest.raises(ValueError, match="page_size must be less"):
        Paginator(page_size=101)


def test_paginated_response_is_generic_for_pydantic_models():
    response = client.get("/openapi.json")

    assert response.status_code == 200, response.text
    schema_name = "PaginatedResponse_Item_"
    assert schema_name in response.json()["components"]["schemas"]
    assert response.json()["components"]["schemas"][schema_name]["properties"][
        "items"
    ] == {
        "items": {"$ref": "#/components/schemas/Item"},
        "title": "Items",
        "type": "array",
    }


def test_sqlalchemy_style_query_sources_use_offset_limit_and_count():
    paginator = Paginator(page=2, page_size=2)

    response = paginator.paginate(FakeQuery(ITEMS))

    assert [item.id for item in response.items] == [3, 4]
    assert response.total == 7
    assert response.page == 2
    assert response.total_pages == 4
    assert response.has_next is True
    assert response.has_previous is True


def test_sqlalchemy_select_sources_calculate_total_with_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all([DbItem(id=index, name=f"item-{index}") for index in range(1, 6)])
        session.commit()

        paginator = Paginator(page=2, page_size=2)
        response = paginator.paginate(
            select(DbItem).order_by(DbItem.id), session=session
        )

    assert [item.id for item in response.items] == [3, 4]
    assert response.total == 5
    assert response.total_pages == 3
    assert response.has_next is True
    assert response.has_previous is True


def test_invalid_pagination_mode_is_rejected():
    paginator = Paginator()

    with pytest.raises(ValueError, match="mode must be either"):
        paginator.paginate(ITEMS, mode="unknown")
