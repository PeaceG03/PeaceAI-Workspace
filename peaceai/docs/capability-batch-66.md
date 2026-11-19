# Capability batch 66

Three more published bug fixes the existing templates do not cover: months corrects typo'd Greek and Dutch month abbreviations, has-own-deep accepts arrays as well as objects when walking a deep own-property path, and copy-descriptor throws when the property being copied does not exist on the provider. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
