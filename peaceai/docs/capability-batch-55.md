# Capability batch 55

Three more published bug fixes the existing templates do not cover: parse-gitignore keeps insertion order instead of sorting patterns, append-string returns early when the suffix is empty so an EOL is not appended, and randomatic type-checks the exclude option rather than the length argument before joining excluded characters. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
