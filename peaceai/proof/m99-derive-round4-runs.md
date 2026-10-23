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

## Generator: seed 100, 5,000 tasks (in progress; resumable shards of 4)

Restarted on 980b244's evidence (eq emitted), so earlier partial parts (eq refused) were discarded.

Interim (13:36Z, shards 0 and 1 complete, 2 and 3 running): 4,598 of 5,000 tasks graded: right 749, refused 3,765,
wrong 84 (74 known-limit, 10 blocking; all blocking are floor_clamp/unwitnessed_cap). The final table replaces this line when shards 2 and 3 finish.

## Mutants at 980b244

6 mutants on the form gate (peaceai/proof/m99-derive-mutation-proof.md, round 4), 6 killed.
