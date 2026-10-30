# M147: English-to-code training pairs (v1)

Step 4 of the general-agent roadmap. Data pipeline and manifest only: no retrain is run, `latest.json` and
promotion are untouched, and no new training pipeline is added. The pairs are the fine-tune corpus format
(`docs.jsonl` + `manifest.jsonl`), so the retrain's own `ft_prepare.py` and `eval_dedup.py` run on them unchanged.

## Pair kinds

| kind   | English side                          | code side                                         |
|--------|---------------------------------------|---------------------------------------------------|
| pr     | merged PR title + description         | the merge commit's first-parent diff (code files) |
| commit | commit message (non-PR, non-chore)    | that commit's diff (code files)                   |
| jsdoc  | `/** doc comment */` + signature      | the function body, at the pinned head             |

## Sources

Only repos pinned in `peaceai/model/nl-pairs.json`: TypeScript repos whose root licence file classifies (by
`classifyLicense`) as MIT, Apache-2.0, BSD-2/3-Clause or ISC, pinned per repo by commit, licence file and sha256.
GPL/LGPL/MPL/Blue Oak/mixed text and a missing licence file refuse the build. PeaceG03 repos and set C v2 repos are
refused by the config check.

## Exclusions

* Built in (`nlpairs.ts`): the 11 public plan-only task repos, `unjs/ufo`, `toss/es-toolkit`, and the #635 search
  fixtures by repo name (`*/is-what`, `*/code-block-writer`).
* Required exclusion file (`--exclusions <file>`; the build refuses without it, or when it is empty or malformed).
  Format: one `owner/repo` or `*/name` per line, `#` comments, case-insensitive. Auditor passes the hidden-half list;
  Builder never sees it. Its sha256 is recorded in the build report and in the manifest header.
* A config repo on the list refuses the whole build with `config_repo_excluded count=N` (never the name).
* A pair whose raw text names an excluded repo is dropped (`mentions_excluded_repo`).
* `peaceai/model/nl-pairs-exclusions-public.txt` is the Builder-visible file the committed manifest was built with.

## Filters

URLs, emails, @mentions, trailers, PR templates, images and checkboxes are scrubbed from the English; URLs in code
become `<url>`; any pair whose text still trips the leak scanner or the hex-secret rule is dropped whole. Diff
files pass the ext-corpus file filter (generated/vendored paths, nested licences, minified, licence headers,
personal info, secrets). Exact duplicates (same diff, same text) are dropped. Caps: total 2,000,000 bytes (inside
`replay.trainMaxBytes`), per-kind budgets, an equal share per (repo, kind).

## Run (box)

    peaceai/bin/nl-pairs-corpus.sh <work> <judge-items v2> <exclusion file> [--write]

nl-pairs.ts -> ft_prepare.py -> ext-fetch.ts --set-c -> eval_dedup.py -> (--write) sha256 manifest
`peaceai/model/nl-pairs-manifest/` and counts `peaceai/model/nl-pairs-summary.json`. The text stays in `<work>`;
only sha256s and counts are committed. `nl-pairs.ts --only <manifest dir>` rebuilds exactly the listed docs (by text
sha256) and refuses if the exclusion file's sha256 differs. GitHub calls follow the M8 rules (fixed cause codes, stop
and fail closed after a rate limit). Stdout is counts and codes only.
