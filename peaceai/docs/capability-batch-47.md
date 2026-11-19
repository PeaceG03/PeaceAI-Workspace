# Capability batch 47

Three more published bug fixes the existing templates do not cover: rename-keys looks up own keys with Object.prototype.hasOwnProperty so objects that do not inherit from Object.prototype do not throw, remove-bom-buffer only strips a UTF-8 BOM from UTF-8 buffers, and requires-regex ignores require() calls that appear only inside quoted strings. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
