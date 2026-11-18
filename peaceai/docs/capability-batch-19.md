# Capability batch 19

Stacked on `51d5e13d5afe9fccd8036659d2fa7257b16a8018`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/mlly`, `unjs/httpxy`, or `h3js/srvx`. They are also not already a fixture, and they are not the libraries used in batches 1 through 18. A notice omits an email address when the license text contains one and records the hash of that redacted text. A license with no email keeps the hash of the text as written.

## What landed

`findExports` does not treat a generic type argument as another export name. `unjs/mlly` at parent `1b09363bd6f95859aea329627ae8e19877f426ed` reads `Map<string, IAppMode>` as the names `APP_MODE_MAP` and `IAppMode`. Commit `abef19c940da8ff31d5cf2c96deefc1035bac1c3` keeps only `APP_MODE_MAP`. The published `test/exports.test.ts` fails on that extra name and passes after the edit.

The proxy stream writes the request body when the outgoing socket is assigned, after `proxyReq` listeners can still change headers. `unjs/httpxy` at parent `0260a5bad5d5bfd7a0a32e94a53093baf3cdc431` pipes the body immediately, so a bodyless request queued behind a busy agent flushes headers before `proxyReq` and `setHeader` throws `ERR_HTTP_HEADERS_SENT`. Commit `10a916bfe39ef002f223535418f3f305af40c793` waits for the `socket` event. The published `test/middleware/web-incoming.test.ts` fails on that error and passes after the edit.

`sendNodeResponse` does not write a Node response that has already ended. `h3js/srvx` at parent `a961c164138ee8eec64831110dfc398808482859` still streams the web body, so the process records `ERR_STREAM_WRITE_AFTER_END`. Commit `20324177dacf8589373333e9aad7b614bada4a15` disposes of that body and, when the response is still flushing, waits for `finish`. The published `test/node-error-paths.test.ts` fails on `ERR_STREAM_WRITE_AFTER_END` and passes after the edit.

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `findExports`, `stream`, and `sendNodeResponse`.

## What this does not change

Candidate order is unchanged. The attempt cap stays 20. Held-out rows were not scored and were not opened.
