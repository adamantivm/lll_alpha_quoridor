"""resolve_path() anchors relative paths (e.g. "models", "wandbmodels") to the
repository root. When the repo was extracted from deep_rabbit_hole, misc.py
moved up one directory level (deep_quoridor/src/utils -> src/utils) but the
parents[N] arithmetic wasn't updated, so relative paths resolved one level
above the repo instead of at its root."""

from pathlib import Path

from utils.misc import resolve_path


def test_resolve_path_anchors_at_repo_root():
    # Identify the repo root by a marker file that genuinely exists there,
    # rather than repeating the parents[N] arithmetic this test protects.
    resolved = resolve_path("models")
    marker = resolved.parent / "pytest.ini"
    assert marker.is_file(), (
        f"resolve_path('models') resolved to {resolved}, whose parent "
        f"{resolved.parent} is not the repository root (missing pytest.ini)"
    )
