import assert from "node:assert/strict";
import test from "node:test";

import { greet, slugify, truncate } from "./text";

test("greet includes the name", () => {
  assert.equal(greet("Ada"), "Hello, Ada");
});

test("slugify lowercases and joins words with dashes", () => {
  assert.equal(slugify("  Hello, World!  "), "hello-world");
});

test("truncate keeps short text and shortens long text", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("a longer sentence", 8), "a longe…");
});
