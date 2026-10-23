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

## family-1: 214 / 5000 tasks graded

| category | n | right | refused | wrong-blocking | wrong-known-limit | right after asking | wrong after asking | still refused |
|---|---|---|---|---|---|---|---|---|
| backoff/amb3 | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| backoff/full | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| backoff/sparse | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| backoff/unwitnessed_cap | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| cap_lin2/amb3 | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| cap_lin2/full | 3 | 0 | 3 | 0 | 0 | 3 | 0 | 0 |
| cap_lin2/sparse | 3 | 0 | 3 | 0 | 0 | 2 | 0 | 1 |
| cap_lin2/unwitnessed_cap | 3 | 0 | 3 | 0 | 0 | 0 | 3 | 0 |
| cap_sq/amb3 | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| cap_sq/full | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| cap_sq/missing_far_side | 3 | 0 | 3 | 0 | 0 | 1 | 0 | 2 |
| cap_sq/sparse | 3 | 2 | 1 | 0 | 0 | 1 | 0 | 0 |
| cap_sq/unwitnessed_cap | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| cond_suffix/full | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| cond_suffix/missing_chars | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| cond_suffix/missing_empty | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| cond_suffix/sparse | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| eq_or_ge/amb3 | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| eq_or_ge/full | 4 | 2 | 2 | 0 | 0 | 2 | 0 | 0 |
| eq_or_ge/missing_eq_neighbour | 4 | 0 | 4 | 0 | 0 | 3 | 0 | 1 |
| eq_or_ge/missing_far_side | 4 | 0 | 4 | 0 | 0 | 2 | 0 | 2 |
| eq_or_ge/missing_point | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0 |
| eq_or_ge/sparse | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| floor_clamp/amb3 | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| floor_clamp/full | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| floor_clamp/missing_far_side | 3 | 0 | 3 | 0 | 0 | 2 | 0 | 1 |
| floor_clamp/sparse | 3 | 0 | 3 | 0 | 0 | 2 | 0 | 1 |
| floor_clamp/unwitnessed_cap | 3 | 0 | 3 | 0 | 0 | 0 | 1 | 2 |
| identity/full | 4 | 2 | 2 | 0 | 0 | 2 | 0 | 0 |
| identity/missing_chars | 4 | 0 | 4 | 0 | 0 | 4 | 0 | 0 |
| identity/narrow_span | 4 | 0 | 4 | 0 | 0 | 4 | 0 | 0 |
| identity/sparse | 4 | 2 | 2 | 0 | 0 | 2 | 0 | 0 |
| if_eq/amb3 | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| if_eq/full | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| if_eq/missing_eq_neighbour | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| if_eq/missing_point | 3 | 0 | 3 | 0 | 0 | 0 | 3 | 0 |
| if_eq/sparse | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| island/amb3 | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| island/full | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| island/hidden_island | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| island/sparse | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| join/full | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| join/missing_chars | 3 | 0 | 3 | 0 | 0 | 3 | 0 | 0 |
| join/sparse | 3 | 1 | 2 | 0 | 0 | 2 | 0 | 0 |
| linear/full | 3 | 1 | 2 | 0 | 0 | 1 | 0 | 1 |
| linear/narrow_span | 3 | 0 | 3 | 0 | 0 | 2 | 0 | 1 |
| linear/sparse | 3 | 0 | 3 | 0 | 0 | 2 | 0 | 1 |
| range/amb3 | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| range/full | 4 | 1 | 3 | 0 | 0 | 2 | 0 | 1 |
| range/missing_far_side | 4 | 0 | 4 | 0 | 0 | 4 | 0 | 0 |
| range/sparse | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| s1_shape/full | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| s1_shape/missing_eq_neighbour | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| s1_shape/missing_far_side | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| s1_shape/missing_point | 4 | 0 | 4 | 0 | 0 | 0 | 4 | 0 |
| s1_shape/sparse | 4 | 0 | 4 | 0 | 0 | 0 | 1 | 3 |
| square/full | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| square/narrow_span | 3 | 0 | 3 | 0 | 0 | 3 | 0 | 0 |
| square/sparse | 3 | 2 | 1 | 0 | 0 | 1 | 0 | 0 |
| threshold/amb3 | 4 | 0 | 4 | 0 | 0 | 3 | 0 | 1 |
| threshold/full | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| threshold/missing_far_side | 4 | 0 | 4 | 0 | 0 | 4 | 0 | 0 |
| threshold/sparse | 4 | 2 | 2 | 0 | 0 | 0 | 0 | 2 |
| **total** | **214** | **31** | **179** | **0** | **4** | **57** | **12** | **110** |

