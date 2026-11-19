# Capability batch 57

Three more published bug fixes the existing templates do not cover: unescape adds the missing `&apos;` HTML entity, set-getter filters `__proto__`, `constructor`, and `prototype` keys so a getter is not defined on the prototype, and koalas returns the last argument when no value is valid instead of returning null. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
