# Capability batch 52

Three more published bug fixes the existing templates do not cover: extract-comments keeps protected comments by default, option-cache looks up an array key as a path, and map-visit visits a plain object as well as an array and forwards extra arguments. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
