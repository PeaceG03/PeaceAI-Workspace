# M99 #491 round 4: run record

Recorded as each run finishes, so a box reset cannot lose a result. Node v22.23.3 (box).

## Suites at 980b244 (CI ci / leak-check / builder-log green: runs 39949529703, 39949529716, 39949529657)

| suite | tests | pass | fail | skipped |
|---|---|---|---|---|
| `npm run typecheck` | exit 0 | | | |
| `npm test` | 17 | 17 | 0 | 0 |
| `npm run test:self` | 5 | 5 | 0 | 0 |
| `npm run test:tools` | 1254 | 1250 | 0 | 4 |

## Evidence by form (runtime counts = the evidence file; bar 10)

111 entries, 89 repos: cap 13, ternary 0, strcat 12, eq 17, or 13, range 42, square 25. Emitted: cap, strcat, eq,
or, range, square. Refused by name: ternary (`derive_unevidenced_form: ternary`). S1 derives
`(status === 429) || (500 <= status && status <= 599)`; S2 derives; S3 is refused (ternary).

Dropped while mining (same filters as fc34763): no gated form, whitespace-identical upstream text, more than 3 per
repo, size, held-out wrong, a module holding an email address (2) or a private-core line (4), and a license text
lmcorpus `classifyLicense` does not recognise (5: rejot-dev/fragno, reactivelib/chart, hexclave/pgmock,
wolfstar-project/wolfstar.rocks, wolfstar-project/code-zero).

## Generator: seed 100, 5,000 tasks (complete; 4 resumable shards, aggregated at 13:50Z)

Restarted on 980b244's evidence (eq emitted), so earlier partial parts (eq refused) were discarded.

Totals: right 815, wrong 93, refused 4,092. Blocking wrong 11, all floor_clamp/unwitnessed_cap "past" (a floor clamp whose cap lies above every example: the disclosed unwitnessed-cap limit); known-limit wrong 82; wrong after asking 170 (+158 known limit); unsafe expressions 0. This is the seed-100 residual the ledger names.

`tsx peaceai/bin/derive-practice.ts --seed 100 --count 5000 --jobs 4` (Node 22):

| category | tasks | right | wrong (inside / past / known limit) | refused | refused with question | truth in answers / asked | after asking: right / wrong / refused / stuck |
|---|---:|---:|---:|---:|---:|---:|---|
| backoff/amb3 | 79 | 0 | 0 (0 / 0 / 0) | 79 | 65 | 70 / 72 | 31 / 0 / 31 / 17 |
| backoff/full | 79 | 79 | 0 (0 / 0 / 0) | 0 | 0 | 0 / 0 | 0 / 0 / 0 / 0 |
| backoff/sparse | 79 | 6 | 0 (0 / 0 / 0) | 73 | 50 | 47 / 51 | 41 / 0 / 2 / 30 |
| backoff/unwitnessed_cap | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 0 / 79 | 0 / 0 / 0 / 79 |
| cap_lin2/amb3 | 79 | 0 | 0 (0 / 0 / 0) | 79 | 73 | 83 / 86 | 1 / 0 / 68 / 10 |
| cap_lin2/full | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 79 / 79 | 79 / 0 / 0 / 0 |
| cap_lin2/sparse | 79 | 0 | 0 (0 / 0 / 0) | 79 | 68 | 100 / 100 | 42 / 0 / 16 / 21 |
| cap_lin2/unwitnessed_cap | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 79 / 79 | 0 / 79 / 0 / 0 |
| cap_sq/amb3 | 79 | 0 | 0 (0 / 0 / 0) | 79 | 31 | 31 / 31 | 22 / 0 / 0 / 57 |
| cap_sq/full | 79 | 79 | 0 (0 / 0 / 0) | 0 | 0 | 0 / 0 | 0 / 0 / 0 / 0 |
| cap_sq/missing_far_side | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 79 / 79 | 39 / 0 / 0 / 40 |
| cap_sq/sparse | 79 | 41 | 0 (0 / 0 / 0) | 38 | 32 | 23 / 69 | 26 / 0 / 3 / 9 |
| cap_sq/unwitnessed_cap | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 0 / 79 | 0 / 0 / 0 / 79 |
| cond_suffix/full | 79 | 0 | 0 (0 / 0 / 0) | 79 | 0 | 0 / 0 | 0 / 0 / 0 / 79 |
| cond_suffix/missing_chars | 79 | 0 | 0 (0 / 0 / 0) | 79 | 0 | 0 / 0 | 0 / 0 / 0 / 79 |
| cond_suffix/missing_empty | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 0 / 79 | 0 / 0 / 0 / 79 |
| cond_suffix/sparse | 79 | 0 | 0 (0 / 0 / 0) | 79 | 32 | 26 / 32 | 0 / 0 / 0 / 79 |
| eq_or_ge/amb3 | 80 | 0 | 0 (0 / 0 / 0) | 80 | 68 | 108 / 108 | 0 / 11 / 57 / 12 |
| eq_or_ge/full | 80 | 21 | 0 (0 / 0 / 0) | 59 | 59 | 173 / 173 | 55 / 0 / 4 / 0 |
| eq_or_ge/missing_eq_neighbour | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 80 / 80 | 64 / 0 / 16 / 0 |
| eq_or_ge/missing_far_side | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 80 / 80 | 44 / 0 / 36 / 0 |
| eq_or_ge/missing_point | 80 | 0 | 80 (0 / 0 / 80) | 0 | 0 | 0 / 0 | 0 / 0 / 0 / 0 |
| eq_or_ge/sparse | 80 | 0 | 2 (0 / 0 / 2) | 78 | 75 | 105 / 105 | 1 / 3 / 71 / 3 |
| floor_clamp/amb3 | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 100 / 118 | 28 / 41 / 7 / 3 |
| floor_clamp/full | 79 | 56 | 0 (0 / 0 / 0) | 23 | 23 | 23 / 23 | 23 / 0 / 0 / 0 |
| floor_clamp/missing_far_side | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 79 / 79 | 73 / 0 / 0 / 6 |
| floor_clamp/sparse | 79 | 27 | 0 (0 / 0 / 0) | 52 | 36 | 32 / 55 | 31 / 0 / 1 / 20 |
| floor_clamp/unwitnessed_cap | 79 | 0 | 11 (0 / 11 / 0) | 68 | 68 | 27 / 68 | 35 / 27 / 6 / 0 |
| identity/full | 80 | 49 | 0 (0 / 0 / 0) | 31 | 31 | 31 / 31 | 31 / 0 / 0 / 0 |
| identity/missing_chars | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 80 / 80 | 0 / 0 / 0 / 80 |
| identity/narrow_span | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 160 / 160 | 80 / 0 / 0 / 0 |
| identity/sparse | 80 | 41 | 0 (0 / 0 / 0) | 39 | 39 | 39 / 39 | 17 / 0 / 0 / 22 |
| if_eq/amb3 | 79 | 0 | 0 (0 / 0 / 0) | 79 | 29 | 55 / 55 | 0 / 0 / 29 / 50 |
| if_eq/full | 79 | 0 | 0 (0 / 0 / 0) | 79 | 76 | 76 / 76 | 0 / 0 / 35 / 44 |
| if_eq/missing_eq_neighbour | 79 | 0 | 0 (0 / 0 / 0) | 79 | 77 | 77 / 77 | 0 / 0 / 36 / 43 |
| if_eq/missing_point | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 79 / 79 | 0 / 79 / 0 / 0 |
| if_eq/sparse | 79 | 0 | 0 (0 / 0 / 0) | 79 | 32 | 35 / 35 | 0 / 4 / 21 / 54 |
| island/amb3 | 79 | 0 | 0 (0 / 0 / 0) | 79 | 76 | 95 / 95 | 0 / 6 / 70 / 3 |
| island/full | 79 | 5 | 0 (0 / 0 / 0) | 74 | 74 | 212 / 212 | 32 / 0 / 42 / 0 |
| island/hidden_island | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 145 / 145 | 1 / 10 / 68 / 0 |
| island/sparse | 79 | 0 | 0 (0 / 0 / 0) | 79 | 78 | 169 / 169 | 0 / 0 / 78 / 1 |
| join/full | 79 | 60 | 0 (0 / 0 / 0) | 19 | 12 | 12 / 12 | 8 / 0 / 0 / 11 |
| join/missing_chars | 79 | 0 | 0 (0 / 0 / 0) | 79 | 2 | 2 / 2 | 0 / 0 / 0 / 79 |
| join/sparse | 79 | 11 | 0 (0 / 0 / 0) | 68 | 43 | 43 / 43 | 15 / 0 / 0 / 53 |
| linear/full | 79 | 51 | 0 (0 / 0 / 0) | 28 | 28 | 28 / 28 | 15 / 0 / 13 / 0 |
| linear/narrow_span | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 158 / 158 | 42 / 0 / 37 / 0 |
| linear/sparse | 79 | 30 | 0 (0 / 0 / 0) | 49 | 49 | 56 / 56 | 40 / 0 / 9 / 0 |
| range/amb3 | 80 | 0 | 0 (0 / 0 / 0) | 80 | 74 | 95 / 95 | 12 / 0 / 62 / 6 |
| range/full | 80 | 10 | 0 (0 / 0 / 0) | 70 | 70 | 204 / 204 | 63 / 0 / 7 / 0 |
| range/missing_far_side | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 80 / 80 | 54 / 0 / 26 / 0 |
| range/sparse | 80 | 0 | 0 (0 / 0 / 0) | 80 | 76 | 121 / 121 | 0 / 1 / 75 / 4 |
| s1_shape/full | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 239 / 239 | 7 / 0 / 73 / 0 |
| s1_shape/missing_eq_neighbour | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 80 / 80 | 2 / 0 / 78 / 0 |
| s1_shape/missing_far_side | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 80 / 80 | 2 / 0 / 78 / 0 |
| s1_shape/missing_point | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 240 / 240 | 0 / 65 / 15 / 0 |
| s1_shape/sparse | 80 | 0 | 0 (0 / 0 / 0) | 80 | 76 | 133 / 133 | 0 / 2 / 74 / 4 |
| square/full | 79 | 79 | 0 (0 / 0 / 0) | 0 | 0 | 0 / 0 | 0 / 0 / 0 / 0 |
| square/narrow_span | 79 | 0 | 0 (0 / 0 / 0) | 79 | 79 | 158 / 158 | 79 / 0 / 0 / 0 |
| square/sparse | 79 | 56 | 0 (0 / 0 / 0) | 23 | 23 | 44 / 44 | 23 / 0 / 0 / 0 |
| threshold/amb3 | 80 | 0 | 0 (0 / 0 / 0) | 80 | 78 | 78 / 78 | 62 / 0 / 16 / 2 |
| threshold/full | 80 | 80 | 0 (0 / 0 / 0) | 0 | 0 | 0 / 0 | 0 / 0 / 0 / 0 |
| threshold/missing_far_side | 80 | 0 | 0 (0 / 0 / 0) | 80 | 80 | 80 / 80 | 80 / 0 / 0 / 0 |
| threshold/sparse | 80 | 34 | 0 (0 / 0 / 0) | 46 | 45 | 45 / 45 | 13 / 0 / 32 / 1 |
| **total** | 5000 | 815 | 93 | 4092 | | | |
wrong accepted (blocking): 11; known-limit wrong: 82; wrong after asking: 170 (+158 known limit); unsafe expressions: 0; runtime 1.0 s; report derive-practice.json

## Mutants at 980b244

6 mutants on the form gate (peaceai/proof/m99-derive-mutation-proof.md, round 4), 6 killed.
