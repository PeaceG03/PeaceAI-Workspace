# notes/stress-v1

PeaceAI stress test v1 (Oct 17 2026). Notes branch only: never merged, never a corpus path, not training data.
- `stress-v1/tasks.py` builds `stress-v1/tasks.json` (66 realistic PeaceSTOCKS tasks at 5c41528, expected skill + expected outcome + acceptance checks).
- `stress-v1/run.py` runs each task through PeaceAI's own Job A (`peaceai/bin/generate.ts`) and Job B (`peaceai/bin/test-candidates.ts`) locally, then grades every candidate PeaceAI accepts independently (applies, 4 typechecks, full PeaceSTOCKS suite, task acceptance test / stub-kill check).
- Results and the score: `stress-v1/REPORT.md`, `stress-v1/report.json`.
