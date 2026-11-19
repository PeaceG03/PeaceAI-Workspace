# Capability batch 64

Three more published bug fixes the existing templates do not cover: assign-value assigns a string value directly instead of merging it as an object, to-list uses the regex match capture for lead text and indent width, and array-sum returns 0 for an empty array instead of reducing without an initial value. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
