# Capability batch 48

Three more published bug fixes the existing templates do not cover: html-tag emits a close tag when the text argument is a boolean instead of stringifying the boolean into the element, pretty-time accepts a numeric nanosecond duration rather than only a process.hrtime() tuple, and condense-newlines normalizes trailing newlines when collapsing runs of blank lines. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
