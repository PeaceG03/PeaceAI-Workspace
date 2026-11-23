# Capability batch 51

Three more published bug fixes the existing templates do not cover: longest-value accepts an object as well as an array, write-json forwards extra JSON.stringify arguments instead of always using a two-space indent, and project-name falls back to process.cwd() when no directory is passed. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
