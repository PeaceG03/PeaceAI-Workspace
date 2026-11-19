# Capability batch 54

Three more published bug fixes the existing templates do not cover: array-unique adds an immutable helper that copies the array before de-duplicating, to-regex escapes non-word characters and retries when a pattern is not a valid regex, and tabstops inserts an empty text node when a placeholder has only its open and close nodes. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
