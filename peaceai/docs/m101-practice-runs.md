# M101 practice runs (seed 100, budget 100000, cells 16000000, 5000 tasks per family)

Engine: 9ba5cb2 (derive behavior identical to 7662f61: both forms on there too). Snapshot of the resumable local runs (peaceai/bin/derive-practice.ts --family <f> --shard j/2); a partial table counts the tasks graded so far.

## template-joins: 451 / 5000 tasks graded

| category | n | right | refused | wrong-blocking | wrong-known-limit | right after asking | wrong after asking | still refused |
|---|---|---|---|---|---|---|---|---|
| template_join/full | 151 | 79 | 72 | 0 | 0 | 53 | 0 | 19 |
| template_join/lookalike | 150 | 71 | 79 | 0 | 0 | 60 | 0 | 19 |
| template_join/missing_empty | 150 | 0 | 150 | 0 | 0 | 121 | 0 | 29 |
| **total** | **451** | **150** | **301** | **0** | **0** | **234** | **0** | **67** |

