# Capability batch 10

Stacked on `19f644d289dd0dabfdddac883ff4513446686172`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `jridgewell/resolve-uri`, `eemeli/yaml`, or `fb55/css-what`. They are also not already a fixture.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Test-as-spec `VERIFIED_TEST_ONLY` is 14. Text `NO_EDIT` is 21 and `ADD_UNSPECIFIED` is 8. This batch does not claim those rows moved. The repairs are general shapes from three different authors, not a template copied from a dev pair. The core archive is not on this machine.

## Families

`resolve` stopped a host at the first colon, so a bracketed IPv6 literal became a truncated host and a port. `jridgewell/resolve-uri` at parent `730a61ad423359a972b7935a4304db04983a3251` does that in `src/resolve-uri.ts`. Commit `1123e444e27f68df245b224be6fa614c255155bc` keeps `\[[^\]]+\]` as the host. The published `test/resolve/ipv6.test.js` fails before that edit and passes after. A check that is not `resolve` is refused. MIT. The license notice omits one email address.

`addToJSMap` copied a merge value before resolving it, so a circular map came out as a `Map` instead of a plain object. `eemeli/yaml` at parent `6c13734af8dac735644d9c137c6d1c79987d97db` does that in `src/schema/yaml-1.1/merge.ts`. Commit `9fa8098fa40e318b260884f3e7b853ddb3b9f023` resolves the source first and requires it to be a `YAMLMap`. The published `tests/doc/anchors.ts` fails before and passes after. A check that is not `MergeKey` is refused. ISC. The license notice omits one email address. A merge of ordinary maps still copies keys that are not already present.

`stringify` left `=`, `&`, `?`, `@`, a backtick, and braces unescaped in an identifier, so the selector was parsed as a different selector. `fb55/css-what` at parent `24c3a50fe98a25cb56ed170955b097d4dd1971f6` does that in `src/stringify.ts`. Commit `b8420ca444cc569d8ec3950bfa1b5a53945d255d` adds those characters to the identifier escape set. The published `src/stringify.spec.ts` fails before and passes after. A check that is not `stringify` is refused. BSD-2-Clause. The license text has no email, so the pinned hash is the text as written.

## Soundness

Each edit is one shape. The host alternative matches a bracketed literal only, so a hostname without brackets still stops at `:` and the port stays a port. The merge edit resolves the value that `addToJSMap` already loaded, and it still refuses a source that is not a map. The identifier set grows by those seven characters; a character that was already escaped stays escaped. Deleting the new line from the repaired file makes the published check fail, in-process and inside the sandbox, so that mutant is rejected. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for each family. A review note that names no function, and `Add <name>` with no value, stay refusals.

## Dropped

`fb55/htmlparser2` `4428592f40cd` drops an unfinished tag at EOF. Its tokenizer imports `entities/decode`, and the generated decode table contains a byte sequence the leak scan reads as an email address, so the unmodified table cannot be committed. `cacjs/cac` `26938a28aaed` leaves an omitted array option absent, and its published file also launches snapshot commands. `sindresorhus/matcher`, `lukeed/klona`, and `fastify/fast-json-stringify` fixes in this search are JavaScript. Libraries already named in the LM exclusion lists, and the libraries used in earlier batches, were not reused.
