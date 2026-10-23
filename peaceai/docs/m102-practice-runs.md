# M102 practice runs (seed 100, budget 100000, cells 16000000, 5000 tasks per family) 

Engine: m102/if-return-chains at cd3fc08 (the merge of m101 1506f6b; 93300fb adds only a ledger entry, same derive code). Snapshot of the resumable local runs (peaceai/bin/derive-practice.ts --family <f> --shard j/2); all three runs complete.

## if-return-chains: 5000 / 5000 tasks graded

| category | n | right | refused | wrong-blocking | wrong-known-limit | right after asking | wrong after asking | still refused |
|---|---|---|---|---|---|---|---|---|
| if_chain/full | 834 | 361 | 473 | 0 | 0 | 0 | 0 | 473 |
| if_chain/lookalike | 833 | 0 | 833 | 0 | 0 | 0 | 0 | 833 |
| if_chain/missing_chars | 833 | 0 | 833 | 0 | 0 | 384 | 0 | 449 |
| if_chain/missing_equal | 834 | 0 | 834 | 0 | 0 | 389 | 0 | 445 |
| if_chain/missing_order | 833 | 0 | 833 | 0 | 0 | 370 | 0 | 463 |
| if_chain/sparse | 833 | 0 | 833 | 0 | 0 | 196 | 0 | 637 |
| **total** | **5000** | **361** | **4639** | **0** | **0** | **1339** | **0** | **3300** |

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
| cap_lin2/amb3 | 79 | 0 | 79 | 0 | 0 | 2 | 0 | 77 |
| cap_lin2/full | 79 | 0 | 79 | 0 | 0 | 79 | 0 | 0 |
| cap_lin2/sparse | 79 | 0 | 79 | 0 | 0 | 42 | 0 | 37 |
| cap_lin2/unwitnessed_cap | 79 | 0 | 79 | 0 | 0 | 0 | 79 | 0 |
| cap_sq/amb3 | 79 | 0 | 79 | 0 | 0 | 43 | 0 | 36 |
| cap_sq/full | 79 | 79 | 0 | 0 | 0 | 0 | 0 | 0 |
| cap_sq/missing_far_side | 79 | 0 | 79 | 0 | 0 | 79 | 0 | 0 |
| cap_sq/sparse | 79 | 41 | 38 | 0 | 0 | 20 | 0 | 18 |
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
| **total** | **5000** | **725** | **4182** | **0** | **93** | **1425** | **316** | **2441** |

## if-return-chains: why refusals stay refused

First-pass refusals (4639): under_specified/chars 2175, ambiguous 925, no_fit 610, unevidenced_form 362, under_specified/rival_budget 294, budget 248, examples 14, under_specified/unread 8, under_specified/order 3.

After asking (3 rounds): right 1339, wrong 0, still refused 3300 (stuck with no question 1927, refused 1373).

- **Form gate (main round 3, from m101 1506f6b):** a program with an `if` (ternary) needs >= 10 ternary entries in the m99 evidence file, which has 0. So comparators and min/max built on `sle` are refused with derive_unevidenced_form: 362 first pass, 474 after asking. Only a bare order test, or one joined by `&&`, is emitted. The 10 M102 sle-ternary entries (cmp 2, desc 2, min 2, max 2, sort asc 1, sort desc 1) are NOT counted as ternary evidence. That would loosen Auditor's gate, so it is Peace/Auditor's decision.
- **Lookalike truths** (case-insensitive, natural, length-first, first-character orders) are outside the DSL by design. They end as derive_no_fit (585) or derive_budget (248), with no question.
- **cmp3 rival_budget** (294): at the practice budget of 100000, a three-way comparator's rival search runs out. At the default budget it finishes (about 2 s). This is a known limit, not a wrong answer.

## Evidence (sle form, bar 10)

11 replaying upstream entries from 8 repos (peaceai/rules/proposals/m102-if-return-chains-evidence.json; Auditor #495 B2 dropped the two equality `&&` entries, isCurrentNav and hostnameMatches, whose upstream is a prefix / wildcard match, not string order): cmp 2, desc 2, min 2, max 2, `(b<=a)?1:-1` 1, `(a<=b)?1:-1` 1, `(d<=q)&&!(d==="")` 1.

## Summary

- if-return-chains: blocking 0, known-limit wrong 0, wrong after asking 0, unsafe 0.
- template-joins regression: right 1345, refused 3655, blocking 0. Identical to M101.
- family-1 regression: right 725, known-limit wrong 93, refused 4182, wrong after asking 97 (+219 known limit), blocking 0. The totals equal M101's, but the tasks do NOT all come out the same (corrected after Auditor #495; compared task by task against m101 1506f6b, same seed, budget and cells, both full 5000-task runs in /workspace/m104runs):
  - First pass: 55 refusals change reason, all in cond_suffix (two string parameters): 31 derive_under_specified/chars, 8 + 9 rival_budget and 7 ambiguous become derive_budget, with no question. Example: task 1700 (`message`, `causeCode`): at m101 the search reaches the program after 73,319 candidates and the chars gate asks one question; at m102 the string-order atoms (`a <= b`, `b <= a`) are among the conditions tried for two string parameters, so the same program is reached only after 153,005 candidates, past the practice budget of 100,000, and the engine refuses with derive_budget and asks nothing. At the default budget it asks the same question as m101. Right, wrong and blocking are unchanged.
  - Questions: 227 tasks ask a different number of questions (3,928 to 4,115 in all). The cause is M102's change to deriveQuestions: a question's rival value is now the result of the nearest example whose result differs from the program's (nearestExample with `unlike`), where m101 took the nearest example and dropped the question when that example's result was the program's. Example: tasks 3000 and 4400 (span gate, number parameters) each ask one more question ((60, 91) and (100, 0)).
  - After asking: right 1425 vs 1357 (cap_sq/missing_far_side +40, cap_sq/amb3 +21, cap_sq/sparse +6, cap_lin2/amb3 +1), 6 cap_lin2 tasks move from stuck to refused, 3 cond_suffix from refused to stuck; wrong after asking unchanged (97 + 219 known limit). The earlier note credited this gain to main's changes; it comes from the same deriveQuestions change (more questions get asked, so the ask loop reaches the cap).
