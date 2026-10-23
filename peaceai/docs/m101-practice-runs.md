# M101 practice runs (seed 100, budget 100000, cells 16000000, 5000 tasks per family)

Engine: 9ba5cb2 (derive behavior identical to 7662f61: both forms on there too). Snapshot of the resumable local runs (peaceai/bin/derive-practice.ts --family <f> --shard j/2); a partial table counts the tasks graded so far.

## template-joins: 1054 / 5000 tasks graded

| category | n | right | refused | wrong-blocking | wrong-known-limit | right after asking | wrong after asking | still refused |
|---|---|---|---|---|---|---|---|---|
| template_join/full | 352 | 182 | 170 | 0 | 0 | 118 | 0 | 52 |
| template_join/lookalike | 351 | 169 | 182 | 0 | 0 | 125 | 0 | 57 |
| template_join/missing_empty | 351 | 0 | 351 | 0 | 0 | 281 | 0 | 70 |
| **total** | **1054** | **351** | **703** | **0** | **0** | **524** | **0** | **179** |

