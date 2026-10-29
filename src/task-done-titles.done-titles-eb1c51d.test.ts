import assert from "node:assert/strict";
import test from "node:test";
import { doneTitles } from "./task-done-titles";

test("doneTitles: the examples from the issue", () => {
  assert.deepEqual(doneTitles([]), []);
  assert.deepEqual(doneTitles([{ title: "a", done: true }]), ["a"]);
  assert.deepEqual(doneTitles([{ title: "a", done: false }]), []);
  assert.deepEqual(doneTitles([{ title: "a", done: true }, { title: "b", done: false }, { title: "c", done: true }]), ["a", "c"]);
  assert.deepEqual(doneTitles([{ title: "x", done: false }, { title: "y", done: false }]), []);
  assert.deepEqual(doneTitles([{ title: "zeta", done: true }, { title: "alpha", done: true }]), ["zeta", "alpha"]);
  assert.deepEqual(doneTitles([{ title: "r", done: true }, { title: "r", done: true }]), ["r", "r"]);
});
