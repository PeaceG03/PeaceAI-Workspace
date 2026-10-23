# M101 practice runs (seed 100, budget 100000, cells 16000000, 5000 tasks per family)

Engine: m101/template-joins at 7662f61 (runs on 9ba5cb2, identical derive behavior). Snapshot of the resumable local runs (peaceai/bin/derive-practice.ts --family <f> --shard j/2); a partial table counts the tasks graded so far.

## template-joins: 5000 / 5000 tasks graded

| category | n | right | refused | wrong-blocking | wrong-known-limit | right after asking | wrong after asking | still refused |
|---|---|---|---|---|---|---|---|---|
| template_join/full | 834 | 432 | 402 | 0 | 0 | 278 | 0 | 124 |
| template_join/lookalike | 833 | 414 | 419 | 0 | 0 | 279 | 0 | 140 |
| template_join/missing_chars | 834 | 0 | 834 | 0 | 0 | 678 | 0 | 156 |
| template_join/missing_digits | 833 | 440 | 393 | 0 | 0 | 250 | 0 | 143 |
| template_join/missing_empty | 833 | 0 | 833 | 0 | 0 | 677 | 0 | 156 |
| template_join/sparse | 833 | 59 | 774 | 0 | 0 | 670 | 0 | 104 |
| **total** | **5000** | **1345** | **3655** | **0** | **0** | **2832** | **0** | **823** |

## family-1: 5000 / 5000 tasks graded

| category | n | right | refused | wrong-blocking | wrong-known-limit | right after asking | wrong after asking | still refused |
|---|---|---|---|---|---|---|---|---|
| backoff/amb3 | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| backoff/full | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| backoff/sparse | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| backoff/unwitnessed_cap | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| cap_lin2/amb3 | 79 | 0 | 79 | 0 | 0 | 1 | 0 | 78 |
| cap_lin2/full | 79 | 0 | 79 | 0 | 0 | 79 | 0 | 0 |
| cap_lin2/sparse | 79 | 0 | 79 | 0 | 0 | 42 | 0 | 37 |
| cap_lin2/unwitnessed_cap | 79 | 0 | 79 | 0 | 0 | 0 | 79 | 0 |
| cap_sq/amb3 | 79 | 0 | 79 | 0 | 0 | 22 | 0 | 57 |
| cap_sq/full | 79 | 79 | 0 | 0 | 0 | 0 | 0 | 0 |
| cap_sq/missing_far_side | 79 | 0 | 79 | 0 | 0 | 39 | 0 | 40 |
| cap_sq/sparse | 79 | 41 | 38 | 0 | 0 | 14 | 0 | 24 |
| cap_sq/unwitnessed_cap | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| cond_suffix/full | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| cond_suffix/missing_chars | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| cond_suffix/missing_empty | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| cond_suffix/sparse | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| eq_or_ge/amb3 | 80 | 0 | 80 | 0 | 0 | 0 | 6 | 74 |
| eq_or_ge/full | 80 | 21 | 59 | 0 | 0 | 55 | 0 | 4 |
| eq_or_ge/missing_eq_neighbour | 80 | 0 | 80 | 0 | 0 | 64 | 0 | 16 |
| eq_or_ge/missing_far_side | 80 | 0 | 80 | 0 | 0 | 44 | 0 | 36 |
| eq_or_ge/missing_point | 80 | 0 | 0 | 0 | 80 | 0 | 0 | 0 |
| eq_or_ge/sparse | 80 | 0 | 78 | 0 | 2 | 0 | 3 | 75 |
| floor_clamp/amb3 | 79 | 0 | 79 | 0 | 0 | 26 | 38 | 15 |
| floor_clamp/full | 79 | 56 | 23 | 0 | 0 | 23 | 0 | 0 |
| floor_clamp/missing_far_side | 79 | 0 | 79 | 0 | 0 | 73 | 0 | 6 |
| floor_clamp/sparse | 79 | 27 | 52 | 0 | 0 | 21 | 0 | 31 |
| floor_clamp/unwitnessed_cap | 79 | 0 | 68 | 0 | 11 | 0 | 27 | 41 |
| identity/full | 80 | 49 | 31 | 0 | 0 | 31 | 0 | 0 |
| identity/missing_chars | 80 | 0 | 80 | 0 | 0 | 80 | 0 | 0 |
| identity/narrow_span | 80 | 0 | 80 | 0 | 0 | 80 | 0 | 0 |
| identity/sparse | 80 | 41 | 39 | 0 | 0 | 39 | 0 | 0 |
| if_eq/amb3 | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| if_eq/full | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| if_eq/missing_eq_neighbour | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| if_eq/missing_point | 79 | 0 | 79 | 0 | 0 | 0 | 79 | 0 |
| if_eq/sparse | 79 | 0 | 79 | 0 | 0 | 0 | 4 | 75 |
| island/amb3 | 79 | 0 | 79 | 0 | 0 | 0 | 2 | 77 |
| island/full | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| island/hidden_island | 79 | 0 | 79 | 0 | 0 | 0 | 10 | 69 |
| island/sparse | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 79 |
| join/full | 79 | 60 | 19 | 0 | 0 | 19 | 0 | 0 |
| join/missing_chars | 79 | 0 | 79 | 0 | 0 | 79 | 0 | 0 |
| join/sparse | 79 | 11 | 68 | 0 | 0 | 68 | 0 | 0 |
| linear/full | 79 | 51 | 28 | 0 | 0 | 15 | 0 | 13 |
| linear/narrow_span | 79 | 0 | 79 | 0 | 0 | 42 | 0 | 37 |
| linear/sparse | 79 | 30 | 49 | 0 | 0 | 40 | 0 | 9 |
| range/amb3 | 80 | 0 | 80 | 0 | 0 | 3 | 0 | 77 |
| range/full | 80 | 10 | 70 | 0 | 0 | 63 | 0 | 7 |
| range/missing_far_side | 80 | 0 | 80 | 0 | 0 | 54 | 0 | 26 |
| range/sparse | 80 | 0 | 80 | 0 | 0 | 0 | 1 | 79 |
| s1_shape/full | 80 | 0 | 80 | 0 | 0 | 0 | 0 | 80 |
| s1_shape/missing_eq_neighbour | 80 | 0 | 80 | 0 | 0 | 0 | 0 | 80 |
| s1_shape/missing_far_side | 80 | 0 | 80 | 0 | 0 | 0 | 0 | 80 |
| s1_shape/missing_point | 80 | 0 | 80 | 0 | 0 | 0 | 65 | 15 |
| s1_shape/sparse | 80 | 0 | 80 | 0 | 0 | 0 | 2 | 78 |
| square/full | 79 | 79 | 0 | 0 | 0 | 0 | 0 | 0 |
| square/narrow_span | 79 | 0 | 79 | 0 | 0 | 79 | 0 | 0 |
| square/sparse | 79 | 56 | 23 | 0 | 0 | 23 | 0 | 0 |
| threshold/amb3 | 80 | 0 | 80 | 0 | 0 | 46 | 0 | 34 |
| threshold/full | 80 | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| threshold/missing_far_side | 80 | 0 | 80 | 0 | 0 | 80 | 0 | 0 |
| threshold/sparse | 80 | 34 | 46 | 0 | 0 | 13 | 0 | 33 |
| **total** | **5000** | **725** | **4182** | **0** | **93** | **1357** | **316** | **2509** |

## Summary (final, both runs complete)

- template-joins: blocking 0, known-limit wrong 0, wrong after asking 0.
- family-1 regression: blocking 0 (bar <= 11), known-limit wrong 93, wrong after asking 97 (+219 known limit), unsafe 0. These are the same totals as the pre-m101 family-1 run with the same seed, so the new forms do not change family-1.
