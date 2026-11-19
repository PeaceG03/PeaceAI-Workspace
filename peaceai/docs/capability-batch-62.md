# Capability batch 62

Three more published bug fixes the existing templates do not cover: is-git-url anchors the optional trailing slash before end-of-string in its git-url regex, group-array accepts object values as group keys (and requires kind-of), and time-stamp exports a .utc helper that formats with UTC getters. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
