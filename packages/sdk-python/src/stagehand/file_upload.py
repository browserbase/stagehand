from __future__ import annotations

import base64
import os
import stat
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
        try:
            path = Path(file).expanduser().resolve()
            with path.open("rb") as handle:
                file_stat = os.fstat(handle.fileno())
                if not stat.S_ISREG(file_stat.st_mode):
                    raise ValueError("set_input_files(): expected a readable file")
                if file_stat.st_size > _MAX_INPUT_FILE_BYTES:
                    raise ValueError(
                        "set_input_files(): file is larger than the 50 MiB upload limit"
                    )
                data = handle.read(_MAX_INPUT_FILE_BYTES + 1)
        except OSError as exc:
            raise ValueError("set_input_files(): expected a readable file") from exc
        if len(data) > _MAX_INPUT_FILE_BYTES:
            raise ValueError("set_input_files(): file is larger than the 50 MiB upload limit")
        values: dict[str, object] = {
            "name": path.name,
            "data": base64.b64encode(data).decode("ascii"),
        }
        last_modified = file_stat.st_mtime_ns // 1_000_000
        if last_modified >= 0:
            values["last_modified"] = last_modified
        return InputFilePayload.model_validate(values)

    if not isinstance(file, FilePayload):
        raise ValueError("set_input_files(): expected a path or FilePayload for every file")
    if not file.name:
        raise ValueError("set_input_files(): file payload name cannot be empty")
    buffer = file.buffer.encode() if isinstance(file.buffer, str) else bytes(file.buffer)
    if len(buffer) > _MAX_INPUT_FILE_BYTES:
        raise ValueError("set_input_files(): file is larger than the 50 MiB upload limit")
    values = {
        "name": file.name,
        "data": base64.b64encode(buffer).decode("ascii"),
    }
    if file.mime_type is not None:
        values["mime_type"] = file.mime_type
    if file.last_modified is not None:
        values["last_modified"] = file.last_modified
    return InputFilePayload.model_validate(values)
