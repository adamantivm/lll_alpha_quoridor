"""The AI report feeds real file paths to an LLM backend. When the repo was
extracted from deep_rabbit_hole these paths lost a directory level, and
nothing caught it -- the failure is a bad prompt, not an exception."""

from pathlib import Path

from v2 import ai_report


def test_repo_root_is_the_repository_root():
    # ai_report.py lives at <repo>/src/v2/ai_report.py
    expected = Path(ai_report.__file__).resolve().parent.parent.parent
    assert (expected / "src" / "v2" / "config.py").is_file()
    assert (expected / "pytest.ini").is_file()


def test_prompt_source_paths_all_exist():
    repo_root = Path(ai_report.__file__).resolve().parent.parent.parent
    prompt = ai_report._build_on_demand_prompt(
        project="p",
        group="g",
        metrics_snapshot=Path("/tmp/metrics.json"),
        repo_root=repo_root,
    )
    for line in prompt.splitlines():
        if line.startswith("- /"):
            assert Path(line[2:]).is_file(), f"prompt cites a missing file: {line[2:]}"
