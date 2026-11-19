# Capability batch 65

Three more published bug fixes the existing templates do not cover: right-pad-values pads a named property on each object in an object-of-objects map (including when the property name is passed first), object.defaults skips non-object arguments when filling in missing defaults, and expand-range throws when the first argument is not a string instead of calling `split` on it. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
