# Capability batch 59

Three more published bug fixes the existing templates do not cover: append-buffer returns early when the suffix is empty so it does not insert a line ending, gfm-code-blocks uses the exec match groups instead of RegExp.$* and records start and end, and object-visit throws a dedicated thisArg error instead of using the expected helper. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
