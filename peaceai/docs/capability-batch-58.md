# Capability batch 58

Three more published bug fixes the existing templates do not cover: stringify-keys escapes separator characters in object keys, delete calls the sync method when no callback is given, and has-value looks up a nested property path before testing whether the value is empty. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
