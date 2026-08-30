from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import AnyUrl, BaseModel, Field

FIXTURES = Path(__file__).resolve().parents[2] / "protocol" / "tests" / "fixtures"


class Cat(BaseModel):
    pet_type: Literal["cat"]
    meows: int


class Dog(BaseModel):
    pet_type: Literal["dog"]
    barks: float


class Pets(BaseModel):
    pet: Cat | Dog = Field(discriminator="pet_type")


class Contact(BaseModel):
    homepage: AnyUrl
    payload: bytes


def test_pydantic_extract_schemas_match_protocol_goldens() -> None:
    cases = (
        ("pydantic-discriminated-union.json", Pets),
        ("pydantic-url-binary.json", Contact),
    )
    for name, model in cases:
        expected = json.loads((FIXTURES / name).read_text())
        assert model.model_json_schema() == expected
