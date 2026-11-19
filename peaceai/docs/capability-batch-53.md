# Capability batch 53

Three more published bug fixes the existing templates do not cover: is-directory treats a missing path as false and reports invalid async arguments through the callback, lazy-cache accepts an alias as the second argument, and regex-not throws when a potentially unsafe pattern is compiled. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
