// Worker-thread entry for test modules written in TypeScript (M99 ledger replay and any later sharded test).
// `new Worker(<file>.ts)` relies on the tsx loader the worker inherits through execArgv; Node 20 does not apply
// those inherited loader hooks inside a worker thread, so a .ts worker entry fails there with
// ERR_UNKNOWN_FILE_EXTENSION (Node 22 applies them, and also strips types natively). This plain .mjs entry
// registers tsx in the worker itself, then imports workerData.tsEntry, so it runs the same on Node 20 and 22.
import { workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

const entry = workerData?.tsEntry;
if (typeof entry !== "string" || !entry.startsWith("file:") || !entry.endsWith(".ts")) throw new Error("ts-worker: workerData.tsEntry must be a file: URL of a .ts module");
register();
await import(entry);
