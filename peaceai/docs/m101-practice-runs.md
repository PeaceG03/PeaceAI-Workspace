# M101 practice runs (seed 100, budget 100000, cells 16000000, 5000 tasks per family)

Engine: 9ba5cb2 (derive behavior identical to 7662f61: both forms on there too). Snapshot of the resumable local runs (peaceai/bin/derive-practice.ts --family <f> --shard j/2); a partial table counts the tasks graded so far.

## template-joins: 1565 / 5000 tasks graded

| category | n | right | refused | wrong-blocking | wrong-known-limit | right after asking | wrong after asking | still refused |
|---|---|---|---|---|---|---|---|---|
| template_join/full | 522 | 275 | 247 | 0 | 0 | 170 | 0 | 77 |
| template_join/lookalike | 521 | 252 | 269 | 0 | 0 | 187 | 0 | 82 |
| template_join/missing_empty | 522 | 0 | 522 | 0 | 0 | 423 | 0 | 99 |
| **total** | **1565** | **527** | **1038** | **0** | **0** | **780** | **0** | **258** |

