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
  Format: one entry per line, `#` comments, case-insensitive:
  * `owner/repo`;
  * `*/name` (any owner);
  * `sha256:<64 hex>`: the sha256 of the lowercased `owner/repo`, so the hidden half is applied without naming it.
    A short, long, non-hex or bare hash line refuses (`exclusions_bad_line`).
  Its sha256 is recorded in the build report and in the manifest header.
* A config repo on the list (by name or by hash) refuses the whole build with `config_repo_excluded count=N`.
  The repo is never named.
* Forks and mirrors: one `repos/{owner}/{repo}` call per pinned repo reads `fork`, `parent` and `source`. If the parent
  or the source is excluded by name or hash, or a fork has neither, the build refuses with
  `config_repo_excluded count=N`. A failed call refuses (`repo_meta_<cause>`). The names stay in memory only.
* A pair whose raw text names an excluded repo is dropped:
  * by name: `mentions_excluded_repo`;
  * by hash: `hidden_name_drop`. The text checked is the PR title and body, the commit message, the diff, and the
    doc comment with its function. Every adjacent pair of segments of every slash-joined token is hashed, which
    covers a bare `owner/repo`, a `github.com/owner/repo` URL or git remote (`.git` stripped) and an npm `@scope/name`.
    Only the count is logged (`hidden_name_drop count=N`).
* `peaceai/model/nl-pairs-exclusions-public.txt` is the Builder-visible name list.
* `peaceai/model/nl-pairs-exclusions-hidden-hashes.txt` is that file verbatim plus Auditor's 15 hash lines. The
  committed manifest and summary are built with it.

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
