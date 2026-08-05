from scripts.generate import prune_unreachable_definitions


def test_prune_unreachable_definitions_keeps_only_transitive_root_dependencies() -> None:
    protocol: dict[str, object] = {
        "type": "object",
        "properties": {"value": {"$ref": "#/$defs/Root"}},
        "$defs": {
            "Root": {"$ref": "#/$defs/Nested"},
            "Nested": {"type": "string"},
            "Removed": {"$ref": "#/$defs/RemovedNested"},
            "RemovedNested": {"type": "number"},
        },
    }

    prune_unreachable_definitions(protocol)

    assert protocol["$defs"] == {
        "Root": {"$ref": "#/$defs/Nested"},
        "Nested": {"type": "string"},
    }
