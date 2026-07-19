from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock


STATES = ("open", "forward_only", "reverse_only", "closed")
_lock = Lock()


class ScenarioStore:
    def __init__(self, data_dir: Path) -> None:
        self.directory = data_dir / "scenarios"
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, scenario_id: str) -> Path:
        safe_id = "".join(char for char in scenario_id if char.isalnum() or char in "-_")
        if not safe_id:
            raise ValueError("scenario_id must contain letters, numbers, hyphens, or underscores")
        return self.directory / f"{safe_id}.json"

    def get(self, scenario_id: str) -> dict[str, str]:
        path = self._path(scenario_id)
        if not path.exists():
            return {}
        payload = json.loads(path.read_text(encoding="utf-8"))
        return {str(key): str(value) for key, value in payload.get("segment_states", {}).items() if value in STATES}

    def cycle(self, scenario_id: str, segment_id: str) -> str:
        if not segment_id:
            raise ValueError("segment_id is required")
        with _lock:
            states = self.get(scenario_id)
            current = states.get(segment_id, "open")
            next_state = STATES[(STATES.index(current) + 1) % len(STATES)]
            if next_state == "open":
                states.pop(segment_id, None)
            else:
                states[segment_id] = next_state
            path = self._path(scenario_id)
            temp_path = path.with_suffix(".tmp")
            temp_path.write_text(
                json.dumps({"scenario_id": scenario_id, "segment_states": states}, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            os.replace(temp_path, path)
        return next_state

    def clear(self, scenario_id: str) -> None:
        """Reset a scenario overlay without touching the immutable baseline graph."""
        with _lock:
            path = self._path(scenario_id)
            temp_path = path.with_suffix(".tmp")
            temp_path.write_text(
                json.dumps({"scenario_id": scenario_id, "segment_states": {}}, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            os.replace(temp_path, path)
