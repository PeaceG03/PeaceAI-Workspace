import { spawn, type ChildProcess } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, isErr, ok, type Result } from "../shared/result";
import { inspectMaterializedCheckout } from "./materialized-checkout";
import type { RepositoryTreeInventory } from "./tree-inventory";

export type GitHubRepository = {
  url: string;
  owner: string;
  name: string;
};

export type RepositorySubmoduleMode = "ignore" | "reject";

export type RepositorySubmoduleSummary = {
  total: number;
  paths: string[];
  pathsTruncated: boolean;
};

export type RepositorySymbolicLinkSummary = {
  total: number;
  paths: string[];
  pathsTruncated: boolean;
};

export type ClonedRepository = {
  rootDir: string;
  inventory?: RepositoryTreeInventory;
  submodules: RepositorySubmoduleSummary;
  symbolicLinks: RepositorySymbolicLinkSummary;
  nonPortablePaths: RepositorySymbolicLinkSummary;
  cleanup: () => void;
};

export type RepositoryCloneOptions = {
  submodules: RepositorySubmoduleMode;
};

export type RepositoryCloner = (
  repository: GitHubRepository,
  options: RepositoryCloneOptions
) => Promise<Result<ClonedRepository, OhriskError>>;

const GITHUB_HOSTNAME = "github.com";
const OWNER_PATTERN = /^(?!-)[A-Za-z0-9-]{1,39}(?<!-)$/;
const REPOSITORY_PATTERN = /^(?![.-])[A-Za-z0-9._-]{1,100}(?<!\.)$/;
const CLONE_TIMEOUT_MS = 120_000;
const TREE_INSPECTION_TIMEOUT_MS = 30_000;
const CHECKOUT_TIMEOUT_MS = 180_000;
const PROCESS_TREE_TERMINATION_GRACE_MS = 5_000;
const MAX_TREE_ENTRIES = 100_000;
const MAX_TREE_BYTES = 640 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_STAGING_BYTES = 1024 * 1024 * 1024;
const MAX_PATH_BYTES = 4_096;
const MAX_PATH_SEGMENTS = 64;
const MAX_SEGMENT_BYTES = 255;
const MAX_GIT_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_GIT_STDERR_BYTES = 64 * 1024;
const MAX_REPORTED_SKIPPED_PATHS = 100;
const PROJECTED_ENTRY_OVERHEAD_BYTES = 4 * 1024;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

type GitRunResult = {
  exitCode: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  sizeLimitExceeded: boolean;
  outputLimitExceeded: boolean;
  spawnError?: string;
};

export function parseGitHubRepositoryUrl(
  value: string
): Result<GitHubRepository, OhriskError> {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return err(invalidRepositoryUrl(value));
  }
  const authority = /^https:\/\/([^/]+)/iu.exec(trimmed)?.[1];

  if (
    url.protocol !== "https:"
    || authority?.toLowerCase() !== GITHUB_HOSTNAME
    || url.hostname.toLowerCase().replace(/\.$/, "") !== GITHUB_HOSTNAME
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.pathname.includes("%")
  ) {
    return err(invalidRepositoryUrl(value));
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return err(invalidRepositoryUrl(value));
  }

  const owner = segments[0] ?? "";
  const rawName = segments[1] ?? "";
  const name = rawName.toLowerCase().endsWith(".git")
    ? rawName.slice(0, -4)
    : rawName;
  if (!OWNER_PATTERN.test(owner) || !REPOSITORY_PATTERN.test(name)) {
    return err(invalidRepositoryUrl(value));
  }

  return ok({
    url: `https://${GITHUB_HOSTNAME}/${owner}/${name}.git`,
    owner,
    name
  });
}

export const cloneGitHubRepository: RepositoryCloner = async (repository, options) => {
  const stagingRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-repository-"));
  const repositoryRoot = path.join(stagingRoot, "repository");
  const cleanup = createOwnedCleanup(stagingRoot);

  try {
    const cloned = await runGit({
      args: cloneArguments(repository.url, repositoryRoot),
      cwd: stagingRoot,
      stagingRoot,
      timeoutMs: CLONE_TIMEOUT_MS
    });
    const cloneFailure = gitFailure(cloned, "clone");
    if (cloneFailure) {
      cleanup();
      return err(cloneFailure);
    }

    const tree = await runGit({
      args: treeArguments(repositoryRoot),
      cwd: stagingRoot,
      stagingRoot,
      timeoutMs: TREE_INSPECTION_TIMEOUT_MS,
      monitorStagingSize: false
    });
    const treeFailure = gitFailure(tree, "inspect");
    if (treeFailure) {
      cleanup();
      return err(treeFailure);
    }

    const validatedTree = validateGitTree(tree.stdout, options);
    if (isErr(validatedTree)) {
      cleanup();
      return validatedTree;
    }

    const checkoutPathspecPath = path.join(stagingRoot, "checkout-pathspec");
    writeFileSync(
      checkoutPathspecPath,
      checkoutPathspec(validatedTree.value.checkoutExcludedPaths),
      { mode: 0o600 }
    );
    const currentStagingBytes = directorySize(stagingRoot, MAX_STAGING_BYTES);
    const projectedStagingBytes = currentStagingBytes
      + validatedTree.value.checkoutBytes
      + (validatedTree.value.checkoutEntryCount * PROJECTED_ENTRY_OVERHEAD_BYTES);
    if (projectedStagingBytes > MAX_STAGING_BYTES) {
      cleanup();
      return err(repositoryLimitError(
        "projected_staging_size",
        projectedStagingBytes,
        MAX_STAGING_BYTES
      ));
    }
    const checkedOut = await runGit({
      args: checkoutArguments(repositoryRoot, checkoutPathspecPath),
      cwd: stagingRoot,
      stagingRoot,
      timeoutMs: CHECKOUT_TIMEOUT_MS,
      monitorStagingSize: false
    });
    const checkoutFailure = gitFailure(checkedOut, "checkout");
    if (checkoutFailure) {
      cleanup();
      return err(checkoutFailure);
    }

    const removedSymbolicLinks = removeMaterializedSymbolicLinks(
      repositoryRoot,
      validatedTree.value.materializedSymbolicLinkPaths
    );
    if (isErr(removedSymbolicLinks)) {
      cleanup();
      return removedSymbolicLinks;
    }

    const materialized = validateMaterializedCheckout(stagingRoot, repositoryRoot);
    if (isErr(materialized)) {
      cleanup();
      return materialized;
    }

    return ok({
      rootDir: repositoryRoot,
      inventory: materialized.value.inventory,
      submodules: validatedTree.value.submodules,
      symbolicLinks: validatedTree.value.symbolicLinks,
      nonPortablePaths: validatedTree.value.nonPortablePaths,
      cleanup
    });
  } catch (cause) {
    cleanup();
    return err(createError({
      code: "REPOSITORY_CLONE_FAILED",
      category: "filesystem",
      message: "Failed to prepare the temporary repository checkout.",
      details: {
        reason: "temporary_repository_failed",
        cause: sanitizeGitDiagnostic(cause instanceof Error ? cause.message : String(cause))
      }
    }));
  }
};

export function cloneArguments(repositoryUrl: string, destination: string): string[] {
  return [
    ...safeGitConfiguration(),
    "clone",
    "--depth",
    "1",
    "--single-branch",
    "--no-tags",
    "--no-checkout",
    "--no-recurse-submodules",
    "--no-local",
    repositoryUrl,
    destination
  ];
}

export function treeArguments(repositoryRoot: string): string[] {
  return [
    ...safeGitConfiguration(),
    "-C",
    repositoryRoot,
    "ls-tree",
    "-r",
    "-z",
    "-l",
    "--full-tree",
    "HEAD"
  ];
}

export function checkoutArguments(repositoryRoot: string, pathspecFile = "checkout-pathspec"): string[] {
  return [
    ...safeGitConfiguration(),
    "-C",
    repositoryRoot,
    "checkout",
    "--force",
    `--pathspec-from-file=${pathspecFile}`,
    "--pathspec-file-nul",
    "HEAD"
  ];
}

export function checkoutPathspec(excludedPaths: string[]): Buffer {
  return Buffer.from([
    ":(top,glob)**",
    ...excludedPaths.map((repositoryPath) => `:(top,exclude,literal)${repositoryPath}`),
    ""
  ].join("\0"), "utf8");
}

export function validateGitTree(
  treeOutput: Buffer,
  options: RepositoryCloneOptions = { submodules: "reject" }
): Result<{
  submodules: RepositorySubmoduleSummary;
  symbolicLinks: RepositorySymbolicLinkSummary;
  nonPortablePaths: RepositorySymbolicLinkSummary;
  checkoutExcludedPaths: string[];
  materializedSymbolicLinkPaths: string[];
  checkoutBytes: number;
  checkoutEntryCount: number;
}, OhriskError> {
  if (treeOutput.length > 0 && treeOutput[treeOutput.length - 1] !== 0) {
    return err(repositoryTreeError("malformed_tree_output"));
  }
  const entries = splitNullTerminated(treeOutput);
  if (entries.length > MAX_TREE_ENTRIES) {
    return err(repositoryLimitError("entry_count", entries.length, MAX_TREE_ENTRIES));
  }

  let totalBytes = 0;
  let checkoutBytes = 0;
  let checkoutEntryCount = 0;
  let submoduleCount = 0;
  const submodulePaths: string[] = [];
  const symbolicLinkPaths: string[] = [];
  const materializedSymbolicLinkPaths: string[] = [];
  const nonPortablePaths: string[] = [];
  const checkoutExcludedPaths = new Set<string>();
  const compatiblePaths = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (const rawEntry of entries) {
    const tabIndex = rawEntry.indexOf(0x09);
    if (tabIndex <= 0) {
      return err(repositoryTreeError("malformed_tree_entry"));
    }

    const header = /^([0-7]{6}) (blob|commit) ([0-9a-f]{40,64}) +([0-9]+|-)$/u.exec(
      rawEntry.subarray(0, tabIndex).toString("ascii")
    );
    if (!header) {
      return err(repositoryTreeError("malformed_tree_entry"));
    }
    const [, mode, type, , sizeText] = header;

    let repositoryPath: string;
    try {
      repositoryPath = decoder.decode(rawEntry.subarray(tabIndex + 1));
    } catch {
      return err(repositoryTreeError("path_not_utf8"));
    }
    const pathValidation = classifyRepositoryPath(repositoryPath, compatiblePaths);
    if (isErr(pathValidation)) {
      return pathValidation;
    }
    const nonPortablePath = pathValidation.value === "non_portable";

    if (mode === "160000") {
      if (type !== "commit") {
        return err(repositoryTreeError("unsupported_entry", repositoryPath));
      }
      if (options.submodules === "reject") {
        return err(repositoryTreeError("submodule", repositoryPath));
      }
      checkoutExcludedPaths.add(repositoryPath);
      submoduleCount += 1;
      if (submodulePaths.length < MAX_REPORTED_SKIPPED_PATHS) {
        submodulePaths.push(repositoryPath);
      }
      continue;
    }

    if (mode === "120000") {
      if (type !== "blob") {
        return err(repositoryTreeError("unsupported_entry", repositoryPath));
      }
      symbolicLinkPaths.push(repositoryPath);
      checkoutExcludedPaths.add(repositoryPath);
      if (!nonPortablePath) materializedSymbolicLinkPaths.push(repositoryPath);
    } else if (type !== "blob") {
      return err(repositoryTreeError("unsupported_entry", repositoryPath));
    } else if (nonPortablePath) {
      nonPortablePaths.push(repositoryPath);
      checkoutExcludedPaths.add(repositoryPath);
    }

    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0) {
      return err(repositoryTreeError("unknown_file_size", repositoryPath));
    }
    if (size > MAX_FILE_BYTES) {
      return err(repositoryLimitError("file_size", size, MAX_FILE_BYTES));
    }
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TREE_BYTES) {
      return err(repositoryLimitError("total_file_size", totalBytes, MAX_TREE_BYTES));
    }
    if (mode !== "120000" && !nonPortablePath) {
      checkoutBytes += size;
      checkoutEntryCount += 1;
    }
  }

  return ok({
    submodules: {
      total: submoduleCount,
      paths: submodulePaths,
      pathsTruncated: submoduleCount > submodulePaths.length
    },
    symbolicLinks: {
      total: symbolicLinkPaths.length,
      paths: symbolicLinkPaths.slice(0, MAX_REPORTED_SKIPPED_PATHS),
      pathsTruncated: symbolicLinkPaths.length > MAX_REPORTED_SKIPPED_PATHS
    },
    nonPortablePaths: {
      total: nonPortablePaths.length,
      paths: nonPortablePaths.slice(0, MAX_REPORTED_SKIPPED_PATHS),
      pathsTruncated: nonPortablePaths.length > MAX_REPORTED_SKIPPED_PATHS
    },
    checkoutExcludedPaths: [...checkoutExcludedPaths],
    materializedSymbolicLinkPaths,
    checkoutBytes,
    checkoutEntryCount
  });
}

export function removeMaterializedSymbolicLinks(
  repositoryRoot: string,
  repositoryPaths: string[]
): Result<void, OhriskError> {
  for (const repositoryPath of repositoryPaths) {
    const pathValidation = validateRepositoryPath(repositoryPath, new Map());
    if (isErr(pathValidation)) {
      return pathValidation;
    }

    const entryPath = path.resolve(repositoryRoot, ...repositoryPath.split("/"));
    const relativePath = path.relative(repositoryRoot, entryPath);
    if (
      relativePath === ""
      || relativePath === ".."
      || relativePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativePath)
    ) {
      return err(repositoryTreeError("symbolic_link_path_outside_repository", repositoryPath));
    }

    try {
      const stats = lstatSync(entryPath, { throwIfNoEntry: false });
      if (!stats) continue;
      if (!stats.isFile() && !stats.isSymbolicLink()) {
        return err(repositoryTreeError("symbolic_link_materialized_as_special_entry", repositoryPath));
      }
      rmSync(entryPath, { force: true });
    } catch (cause) {
      return err(createError({
        code: "REPOSITORY_CHECKOUT_FAILED",
        category: "filesystem",
        message: "Failed to remove a skipped symbolic link from the temporary checkout.",
        details: {
          reason: "symbolic_link_cleanup_failed",
          path: repositoryPath,
          cause: sanitizeGitDiagnostic(cause instanceof Error ? cause.message : String(cause))
        }
      }));
    }
  }

  return ok(undefined);
}

function safeGitConfiguration(): string[] {
  return [
    "-c", "protocol.allow=never",
    "-c", "protocol.https.allow=always",
    "-c", "http.followRedirects=initial",
    "-c", "credential.helper=",
    "-c", "core.askPass=",
    "-c", "core.longpaths=true",
    "-c", "core.symlinks=false",
    "-c", "submodule.recurse=false"
  ];
}

function validateRepositoryPath(
  repositoryPath: string,
  compatiblePaths: Map<string, string>
): Result<void, OhriskError> {
  const classification = classifyRepositoryPath(repositoryPath, compatiblePaths);
  if (isErr(classification)) return classification;
  return classification.value === "portable"
    ? ok(undefined)
    : err(repositoryTreeError("invalid_path_segment", repositoryPath));
}

function classifyRepositoryPath(
  repositoryPath: string,
  compatiblePaths: Map<string, string>
): Result<"portable" | "non_portable", OhriskError> {
  const pathBytes = Buffer.byteLength(repositoryPath, "utf8");
  const segments = repositoryPath.split("/");
  if (
    repositoryPath === ""
    || repositoryPath.startsWith("/")
    || repositoryPath.includes("\\")
    || pathBytes > MAX_PATH_BYTES
    || segments.length > MAX_PATH_SEGMENTS
  ) {
    return err(repositoryTreeError("invalid_path", repositoryPath));
  }

  let prefix = "";
  for (const segment of segments) {
    if (
      segment === ""
      || segment === "."
      || segment === ".."
      || segment.toLowerCase() === ".git"
    ) {
      return err(repositoryTreeError("invalid_path_segment", repositoryPath));
    }
    if (
      Buffer.byteLength(segment, "utf8") > MAX_SEGMENT_BYTES
      || /[\u0000-\u001f\u007f<>:"|?*]/u.test(segment)
      || /[. ]$/u.test(segment)
      || RESERVED_WINDOWS_NAME.test(segment)
    ) {
      return ok("non_portable");
    }

    prefix = prefix ? `${prefix}/${segment}` : segment;
    const compatibilityKey = prefix.normalize("NFC").toLowerCase();
    const existing = compatiblePaths.get(compatibilityKey);
    if (existing !== undefined && existing !== prefix) {
      return ok("non_portable");
    }
    compatiblePaths.set(compatibilityKey, prefix);
  }

  return ok("portable");
}

function validateMaterializedCheckout(
  stagingRoot: string,
  repositoryRoot: string
): Result<{
  inventory: RepositoryTreeInventory;
}, OhriskError> {
  const inspected = inspectMaterializedCheckout({
    stagingRoot,
    repositoryRoot,
    maxStagingBytes: MAX_STAGING_BYTES,
    maxRepositoryBytes: MAX_TREE_BYTES,
    maxFileBytes: MAX_FILE_BYTES,
    maxRepositoryEntries: MAX_TREE_ENTRIES
  });
  if (isErr(inspected)) {
    const issue = inspected.error;
    return err(
      issue.actual === undefined || issue.limit === undefined
        ? repositoryTreeError(issue.reason)
        : repositoryLimitError(issue.reason, issue.actual, issue.limit)
    );
  }
  return ok({
    inventory: inspected.value.inventory
  });
}

function splitNullTerminated(buffer: Buffer): Buffer[] {
  const entries: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index > start) entries.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start !== buffer.length) {
    entries.push(buffer.subarray(start));
  }
  return entries;
}

async function runGit(input: {
  args: string[];
  cwd: string;
  stagingRoot: string;
  timeoutMs: number;
  monitorStagingSize?: boolean;
}): Promise<GitRunResult> {
  if (input.timeoutMs <= 0) {
    return emptyGitFailure({ timedOut: true });
  }

  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let sizeLimitExceeded = false;
    let outputLimitExceeded = false;
    let settled = false;
    const child = spawn("git", input.args, {
      cwd: input.cwd,
      env: gitEnvironment(),
      detached: process.platform !== "win32",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let terminationDeadline: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: GitRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (sizeMonitor) clearInterval(sizeMonitor);
      if (terminationDeadline) clearTimeout(terminationDeadline);
      resolve(result);
    };
    const stop = (): void => {
      terminateGitProcessTree(child);
      if (!terminationDeadline) {
        terminationDeadline = setTimeout(() => finish({
          exitCode: null,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
          sizeLimitExceeded,
          outputLimitExceeded
        }), PROCESS_TREE_TERMINATION_GRACE_MS);
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);
    const sizeMonitor = input.monitorStagingSize === false
      ? undefined
      : setInterval(() => {
          if (directorySize(input.stagingRoot, MAX_STAGING_BYTES) > MAX_STAGING_BYTES) {
            sizeLimitExceeded = true;
            stop();
          }
        }, 250);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_GIT_STDOUT_BYTES) {
        outputLimitExceeded = true;
        stop();
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, MAX_GIT_STDERR_BYTES - stderrBytes);
      if (remaining > 0) stderr.push(chunk.subarray(0, remaining));
      stderrBytes += chunk.length;
    });
    child.once("error", (cause) => finish({
      exitCode: null,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString("utf8"),
      timedOut,
      sizeLimitExceeded,
      outputLimitExceeded,
      spawnError: cause.message
    }));
    child.once("close", (exitCode) => finish({
      exitCode,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString("utf8"),
      timedOut,
      sizeLimitExceeded,
      outputLimitExceeded
    }));
  });
}

function terminateGitProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill("SIGKILL");
    return;
  }

  if (process.platform === "win32") {
    const terminator = spawn("taskkill.exe", windowsProcessTreeKillArguments(pid), {
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
    terminator.once("error", () => {
      child.kill("SIGKILL");
    });
    terminator.unref();
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export function windowsProcessTreeKillArguments(pid: number): string[] {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Process tree termination requires a positive integer PID.");
  }
  return ["/PID", String(pid), "/T", "/F"];
}

function directorySize(root: string, stopAfter: number): number {
  const pending = [root];
  let total = 0;
  while (pending.length > 0 && total <= stopAfter) {
    const current = pending.pop();
    if (!current) continue;
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) continue;
    if (stats.isFile()) {
      total += stats.size;
      continue;
    }
    if (!stats.isDirectory()) continue;
    try {
      for (const name of readdirSync(current)) pending.push(path.join(current, name));
    } catch {
      // A Git worker can rename pack files while the bounded size check walks the staging tree.
    }
  }
  return total;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      /^GIT_CONFIG(?:_|$)/u.test(name)
      || /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|INDEX_FILE|CEILING_DIRECTORIES|EXEC_PATH|SSH|SSH_COMMAND|ASKPASS|PROXY_COMMAND)$/u.test(name)
    ) {
      delete environment[name];
    }
  }
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_ALLOW_PROTOCOL: "https",
    GIT_OPTIONAL_LOCKS: "0"
  };
}

function gitFailure(result: GitRunResult, stage: "clone" | "inspect" | "checkout"): OhriskError | undefined {
  if (
    result.exitCode === 0
    && !result.timedOut
    && !result.sizeLimitExceeded
    && !result.outputLimitExceeded
    && !result.spawnError
  ) {
    return undefined;
  }

  if (result.sizeLimitExceeded) {
    return repositoryLimitError("staging_size", MAX_STAGING_BYTES + 1, MAX_STAGING_BYTES);
  }

  const reason = result.timedOut
    ? "timeout"
    : result.outputLimitExceeded
      ? "git_output_limit"
      : result.spawnError
        ? "git_not_available"
        : `${stage}_failed`;
  const details = {
    stage,
    reason,
    ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
    ...(result.spawnError ? { cause: sanitizeGitDiagnostic(result.spawnError) } : {}),
    ...(!result.spawnError && result.stderr.trim()
      ? { cause: sanitizeGitDiagnostic(result.stderr) }
      : {})
  };
  return stage === "clone"
    ? createError({
        code: "REPOSITORY_CLONE_FAILED",
        category: "network",
        message: "Failed to clone the GitHub repository.",
        details
      })
    : createError({
        code: "REPOSITORY_CHECKOUT_FAILED",
        category: "filesystem",
        message: "Failed to prepare the GitHub repository for scanning.",
        details
      });
}

function emptyGitFailure(input: { timedOut?: boolean }): GitRunResult {
  return {
    exitCode: null,
    stdout: Buffer.alloc(0),
    stderr: "",
    timedOut: input.timedOut ?? false,
    sizeLimitExceeded: false,
    outputLimitExceeded: false
  };
}

function createOwnedCleanup(stagingRoot: string): () => void {
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(stagingRoot, { recursive: true, force: true });
  };
}

function invalidRepositoryUrl(value: string): OhriskError {
  return createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: "Repository input must be a public GitHub HTTPS repository URL.",
    details: {
      repository: safeRepositoryUrl(value),
      expected: "https://github.com/<owner>/<repository>[.git]"
    }
  });
}

function repositoryTreeError(reason: string, repositoryPath?: string): OhriskError {
  return createError({
    code: "REPOSITORY_TREE_INVALID",
    category: "unsupported_input",
    message: "The repository tree cannot be checked out safely on supported platforms.",
    details: {
      reason,
      ...(repositoryPath ? { path: repositoryPath } : {})
    }
  });
}

function repositoryLimitError(reason: string, actual: number, limit: number): OhriskError {
  return createError({
    code: "REPOSITORY_LIMIT_EXCEEDED",
    category: "unsupported_input",
    message: "The repository exceeds the remote scan resource limits.",
    details: { reason, actual, limit }
  });
}

function safeRepositoryUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return "<invalid>";
  }
}

function sanitizeGitDiagnostic(value: string): string {
  const lastLine = value
    .replace(/[A-Za-z]:\\[^\r\n]*\\ohrisk-repository-[^\r\n'"]*/giu, "<temporary repository>")
    .replace(/\/[^\r\n]*\/ohrisk-repository-[^\r\n'"]*/gu, "<temporary repository>")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .trim()
    .slice(-500);
  return lastLine || "Git did not provide a diagnostic.";
}
