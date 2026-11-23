# Capability batch 61

Three more published bug fixes the existing templates do not cover: snakecase uppercases the result when options.uppercase is set, object.omit accepts a filter function as the last argument and forwards remaining keys, and lang-map exports the languages object by default with lang/ext helpers attached. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
