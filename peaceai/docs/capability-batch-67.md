# Capability batch 67

Three more published bug fixes the existing templates do not cover: center-align honors a width argument when padding a string or its lines, deep-bind exposes helper-named options on options[helperName] (including non-object values), and expand-brackets escapes dashes that are not part of a range in a character class. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
