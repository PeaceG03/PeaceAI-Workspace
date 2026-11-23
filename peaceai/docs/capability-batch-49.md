# Capability batch 49

Three more published bug fixes the existing templates do not cover: is-equal-shallow counts own keys on both objects so a subset is not treated as equal, wordcount includes Cyrillic letters in its word-matching pattern, and to-object-path joins an Arguments object into a dotted path instead of stringifying it as `[object Arguments]`. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
