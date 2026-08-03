from __future__ import annotations

import base64
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from ._generated.models import InputFilePayload

_MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class FilePayload:
    name: str
    buffer: bytes | bytearray | memoryview | str
    mime_type: str | None = None
    last_modified: int | None = None


FileInput = str | Path | FilePayload


def normalize_file_input(
    files: FileInput | Sequence[FileInput],
) -> list[InputFilePayload]:
    entries = [files] if isinstance(files, (str, Path, FilePayload)) else list(files)
    return [_normalize_file(entry) for entry in entries]


def _normalize_file(file: FileInput) -> InputFilePayload:
    if isinstance(file, (str, Path)):
        path = Path(file).expanduser().resolve()
        if not path.is_file():
            raise ValueError(f"set_input_files(): expected a readable file at {path}")
        stat = path.stat()
        if stat.st_size > _MAX_INPUT_FILE_BYTES:
            raise ValueError("set_input_files(): file is larger than the 50 MiB upload limit")
        return InputFilePayload(
            name=path.name,
            data=base64.b64encode(path.read_bytes()).decode("ascii"),
            last_modified=stat.st_mtime_ns // 1_000_000,
        )

    if not file.name:
        raise ValueError("set_input_files(): file payload name cannot be empty")
    buffer = file.buffer.encode() if isinstance(file.buffer, str) else bytes(file.buffer)
    if len(buffer) > _MAX_INPUT_FILE_BYTES:
        raise ValueError("set_input_files(): file is larger than the 50 MiB upload limit")
    values: dict[str, object] = {
        "name": file.name,
        "data": base64.b64encode(buffer).decode("ascii"),
    }
    if file.mime_type is not None:
        values["mime_type"] = file.mime_type
    if file.last_modified is not None:
        values["last_modified"] = file.last_modified
    return InputFilePayload.model_validate(values)
