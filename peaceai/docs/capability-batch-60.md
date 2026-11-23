# Capability batch 60

Three more published bug fixes the existing templates do not cover: list-item drops the tilde from the default bullet characters so a fourth-level item uses a hyphen, collection-visit forwards remaining arguments with apply so a second value reaches each visited setter, and filter-values passes the key to the isMatch predicate so a filter can select by property name. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
