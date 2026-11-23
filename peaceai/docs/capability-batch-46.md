# Capability batch 46

Three more published bug fixes the existing templates do not cover: parse-filepath preserves the basename when dirname is ".", is-self-closing lower-cases the tag name before lookup, and exponential-moving-average rounds the default range so odd-length arrays do not produce a fractional window. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
