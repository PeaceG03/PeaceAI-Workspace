# Capability batch 56

Three more published bug fixes the existing templates do not cover: tokenize-comment uses the actual fence length instead of a hardcoded three-backtick close, map-config defaults a missing app to an empty object so mapping does not read properties of undefined, and data-store writes `{name}.json` instead of `{name}/data.json`. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
