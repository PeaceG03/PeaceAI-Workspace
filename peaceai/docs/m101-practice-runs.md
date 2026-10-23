# M101 practice runs (seed 100, budget 100000, cells 16000000, 5000 tasks per family)

Engine: 9ba5cb2 (derive behavior identical to 7662f61: both forms on there too). Snapshot of the resumable local runs (peaceai/bin/derive-practice.ts --family <f> --shard j/2); a partial table counts the tasks graded so far.

## template-joins: 3171 / 5000 tasks graded

| category | n | right | refused | wrong-blocking | wrong-known-limit | right after asking | wrong after asking | still refused |
|---|---|---|---|---|---|---|---|---|
| template_join/full | 649 | 331 | 318 | 0 | 0 | 222 | 0 | 96 |
| template_join/lookalike | 649 | 314 | 335 | 0 | 0 | 233 | 0 | 102 |
| template_join/missing_chars | 408 | 0 | 408 | 0 | 0 | 343 | 0 | 65 |
| template_join/missing_digits | 408 | 223 | 185 | 0 | 0 | 122 | 0 | 63 |
| template_join/missing_empty | 649 | 0 | 649 | 0 | 0 | 519 | 0 | 130 |
| template_join/sparse | 408 | 27 | 381 | 0 | 0 | 326 | 0 | 55 |
| **total** | **3171** | **895** | **2276** | **0** | **0** | **1765** | **0** | **511** |

