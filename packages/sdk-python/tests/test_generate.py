from scripts.generate import _use_model_default_factories


def test_generated_model_dict_defaults_get_factories_without_field_mappings() -> None:
    source = """\
class NewModel(WireModel):
    value: str

class NestedModel(NewModel):
    extra: str

class SchemaModel(RootModel[dict[str, object]]):
    root: dict[str, object]

class NewParams(WireModel):
    options: NestedModel = {"value": "one", "extra": "two"}
    schema: SchemaModel | None = {"type": "object"}
    headers: dict[str, str] = {"x-test": "value"}
    models: dict[str, NewModel] = {"item": {"value": "one"}}
"""

    result = _use_model_default_factories(source)

    assert "lambda: NestedModel.model_validate(" in result
    assert "lambda: SchemaModel.model_validate(" in result
    assert 'headers: dict[str, str] = {"x-test": "value"}' in result
    assert 'models: dict[str, NewModel] = {"item": {"value": "one"}}' in result
