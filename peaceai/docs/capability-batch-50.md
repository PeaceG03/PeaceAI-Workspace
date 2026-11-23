# Capability batch 50

Three more published bug fixes the existing templates do not cover: has-prop joins an array or a list of keys into a dotted path, omit-deep unsets nested keys given in dot notation, and is-odd rejects a non-integer instead of treating a float as odd or even. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
