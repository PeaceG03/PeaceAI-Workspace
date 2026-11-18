import { writeSync } from "node:fs";
export function suite(_name) {
  const tests = [];
  const test = (title, fn) => { tests.push({ title, fn }); };
  test.run = () => {
    for (const t of tests) {
      try { t.fn(); }
      catch (e) {
        writeSync(1, "Error: " + (e && e.stack ? e.stack : e) + "\n");
        process.exitCode = 1;
      }
    }
  };
  return test;
}
