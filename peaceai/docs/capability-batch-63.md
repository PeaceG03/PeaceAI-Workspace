# Capability batch 63

Three more published bug fixes the existing templates do not cover: write exports a `.stream` helper that creates intermediate directories then opens a write stream, parse-author parses name/email/url with independent matches so misordered parts still work, and fs-exists-sync returns false early when filepath is missing or not a string. Each repair is refused unless the exact parent file is present, and the published mocha test must pass afterwards.

This batch does not change the official score.
