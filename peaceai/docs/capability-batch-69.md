# Capability batch 69

Three more published bug fixes the existing templates do not cover: map-files re-resolves glob results against cwd so file paths stay valid, pad-right pads a string to a target length instead of appending that many characters, and map-cache exposes `del` instead of `delete` when removing an entry. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
