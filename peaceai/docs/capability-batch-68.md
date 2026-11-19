# Capability batch 68

Three more published bug fixes the existing templates do not cover: sort-object looks up sort keys that contain dots via get() instead of bracket access, to-file resolves a glob-parent file.base against cwd so the base is absolute, and file-stat exposes lstat on the file object and as an exported method. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
