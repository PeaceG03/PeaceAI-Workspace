# Capability batch 45

Three more published bug fixes the existing templates do not cover: log-ok preserves leading whitespace before the checkmark, object.pick refuses a non-object (including null) and allows functions, and parse-glob escapes the inside of character classes, braces, and parens. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
