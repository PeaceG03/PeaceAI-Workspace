import { join } from "node:path";
import { readFileOrNull } from "./fs-helpers.js";
import { parseBoolean, parseEnum, parseInlineArray } from "./communication-validators.js";
import type {
  CommunicationConfig,
  CommunicationProfile,
} from "./types.js";

const FILE_NAME = "communication.yaml";

const VALID_TONES: ReadonlySet<string> = new Set(["friendly", "terse", "formal"]);
const VALID_VERBOSITY: ReadonlySet<string> = new Set(["brief", "detailed", "structured"]);
const VALID_EXPERTISE: ReadonlySet<string> = new Set(["junior", "senior"]);
const VALID_LANGUAGES: ReadonlySet<string> = new Set(["ru", "en", "auto"]);
const VALID_OUTPUTS: ReadonlySet<string> = new Set([
  "code_first",
  "with_alternatives",
  "review_template",
]);

type FieldKind = "enum" | "boolean" | "string" | "array";

interface FieldSpec {
  kind: FieldKind;
  validValues?: ReadonlySet<string>;
}

// Prototype-less map: prevents lookups like FIELD_SPECS["constructor"] from
// resolving to Object.prototype.constructor. Defense-in-depth: hasOwnProperty
// check at the lookup site is the primary guard; this is the second layer.
const FIELD_SPECS: { readonly [field: string]: FieldSpec } = Object.assign(
  Object.create(null) as { [field: string]: FieldSpec },
  {
    language: { kind: "enum", validValues: VALID_LANGUAGES },
    fallback_language: { kind: "enum", validValues: VALID_LANGUAGES },
    code_comments: { kind: "enum", validValues: VALID_LANGUAGES },
    commit_messages: { kind: "enum", validValues: VALID_LANGUAGES },
    docs_language: { kind: "enum", validValues: VALID_LANGUAGES },
    session_logs: { kind: "enum", validValues: VALID_LANGUAGES },
    tone: { kind: "enum", validValues: VALID_TONES },
    verbosity: { kind: "enum", validValues: VALID_VERBOSITY },
    expertise: { kind: "enum", validValues: VALID_EXPERTISE },
    output: { kind: "enum", validValues: VALID_OUTPUTS },
    explanations: { kind: "enum", validValues: VALID_OUTPUTS },
    ask_before_acting: { kind: "boolean" },
    emojis: { kind: "boolean" },
    output_format: { kind: "string" },
    severity_levels: { kind: "array" },
  } satisfies { [field: string]: FieldSpec },
);

const VALID_PROFILE_FIELDS: readonly string[] = Object.keys(FIELD_SPECS);

// Reserved JavaScript identifiers that, if used as object keys via `obj[key] = ...`,
// can mutate the prototype chain. Rejected at both profile-name and field-name layers.
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

interface ParsedLine {
  indent: number;
  key: string;
  value: string;
}

type ProfileDraft = Partial<CommunicationProfile>;

export function loadCommunicationConfig(vaultPath: string): CommunicationConfig | null {
  const filePath = join(vaultPath, FILE_NAME);
  const content = readFileOrNull(filePath);
  if (content === null) return null;
  return parseAndValidateCommunicationYaml(content, FILE_NAME);
}

function parseAndValidateCommunicationYaml(
  content: string,
  filePath: string,
): CommunicationConfig {
  const lines = content.split("\n");

  let activeProfile: string | null = null;
  let inProfilesSection = false;
  // Prototype-less accumulator: prevents `profiles["__proto__"] = ...` from
  // mutating Object.prototype. Defense-in-depth alongside RESERVED_KEYS check.
  const profiles: { [name: string]: ProfileDraft } = Object.create(null) as {
    [name: string]: ProfileDraft;
  };
  let currentProfileName: string | null = null;
  let seenFields: Set<string> = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;

    if (isBlankOrComment(rawLine)) continue;
    rejectTabIndent(rawLine, filePath, lineNum);

    const parsed = parseYamlLine(rawLine);
    if (parsed === null) {
      throw new Error(`${filePath}:${lineNum}: malformed line '${rawLine}'`);
    }

    if (parsed.indent === 0) {
      ({ activeProfile, inProfilesSection } = handleTopLevel(
        parsed, activeProfile, inProfilesSection, filePath, lineNum,
      ));
      currentProfileName = null;
      continue;
    }

    if (!inProfilesSection) {
      throw new Error(
        `${filePath}:${lineNum}: indented field '${parsed.key}' before 'profiles:' header`,
      );
    }

    if (parsed.indent === 2) {
      currentProfileName = startProfile(parsed, profiles, filePath, lineNum);
      seenFields = new Set();
      continue;
    }

    if (parsed.indent === 4) {
      if (currentProfileName === null) {
        throw new Error(
          `${filePath}:${lineNum}: field '${parsed.key}' has no parent profile`,
        );
      }
      assignProfileField(
        profiles[currentProfileName]!, parsed.key, parsed.value,
        currentProfileName, seenFields, filePath, lineNum,
      );
      continue;
    }

    throw new Error(
      `${filePath}:${lineNum}: unexpected indent ${parsed.indent} (expected 0, 2, or 4)`,
    );
  }

  return finalize(activeProfile, profiles, filePath);
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

function rejectTabIndent(line: string, filePath: string, lineNum: number): void {
  const leading = line.match(/^[\t ]*/)?.[0] ?? "";
  if (leading.includes("\t")) {
    throw new Error(`${filePath}:${lineNum}: tab in indentation — use spaces, not tabs`);
  }
}

function parseYamlLine(line: string): ParsedLine | null {
  const match = line.match(/^( *)([\w][\w_-]*):\s*(.*)$/);
  if (!match) return null;
  return {
    indent: match[1]!.length,
    key: match[2]!,
    value: match[3]!.trim(),
  };
}

function handleTopLevel(
  parsed: ParsedLine,
  activeProfile: string | null,
  inProfilesSection: boolean,
  filePath: string,
  lineNum: number,
): { activeProfile: string | null; inProfilesSection: boolean } {
  if (parsed.key === "active_profile") {
    if (parsed.value === "") {
      throw new Error(`${filePath}:${lineNum}: active_profile has empty value`);
    }
    return { activeProfile: parsed.value, inProfilesSection };
  }
  if (parsed.key === "profiles") {
    if (parsed.value !== "") {
      throw new Error(
        `${filePath}:${lineNum}: 'profiles:' header must have no inline value`,
      );
    }
    return { activeProfile, inProfilesSection: true };
  }
  throw new Error(
    `${filePath}:${lineNum}: unknown top-level key '${parsed.key}' — expected 'active_profile' or 'profiles'`,
  );
}

function startProfile(
  parsed: ParsedLine,
  profiles: { [name: string]: ProfileDraft },
  filePath: string,
  lineNum: number,
): string {
  if (RESERVED_KEYS.has(parsed.key)) {
    throw new Error(
      `${filePath}:${lineNum}: profile name '${parsed.key}' is a reserved JavaScript identifier`,
    );
  }
  if (parsed.value !== "") {
    throw new Error(
      `${filePath}:${lineNum}: profile name '${parsed.key}' must be followed by ':' only (no inline value)`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(profiles, parsed.key)) {
    throw new Error(`${filePath}:${lineNum}: duplicate profile '${parsed.key}'`);
  }
  profiles[parsed.key] = Object.create(null) as ProfileDraft;
  return parsed.key;
}

function assignProfileField(
  profile: ProfileDraft,
  key: string,
  value: string,
  profileName: string,
  seenFields: Set<string>,
  filePath: string,
  lineNum: number,
): void {
  // Whitelist check via hasOwnProperty: prevents prototype-chain lookup like
  // FIELD_SPECS["constructor"] from returning Object.prototype.constructor.
  if (!Object.prototype.hasOwnProperty.call(FIELD_SPECS, key)) {
    throw new Error(
      `${filePath}:${lineNum}: unknown field '${key}' in profile '${profileName}' — valid fields: ${VALID_PROFILE_FIELDS.join(", ")}`,
    );
  }
  const spec = FIELD_SPECS[key]!;
  if (seenFields.has(key)) {
    throw new Error(
      `${filePath}:${lineNum}: duplicate field '${key}' in profile '${profileName}'`,
    );
  }
  seenFields.add(key);

  const parsed = parseFieldValue(spec, value, key, profileName, filePath, lineNum);
  // Spec drives validation; assignment via Record cast keeps types narrow at boundary.
  (profile as Record<string, unknown>)[key] = parsed;
}

function parseFieldValue(
  spec: FieldSpec,
  value: string,
  fieldName: string,
  profileName: string,
  filePath: string,
  lineNum: number,
): string | boolean | string[] {
  switch (spec.kind) {
    case "enum":
      return parseEnum(value, spec.validValues!, fieldName, profileName, filePath, lineNum);
    case "boolean":
      return parseBoolean(value, fieldName, filePath, lineNum);
    case "string":
      if (value === "") {
        throw new Error(`${filePath}:${lineNum}: field '${fieldName}' has empty value`);
      }
      return value;
    case "array":
      return parseInlineArray(value, fieldName, filePath, lineNum);
  }
}

function finalize(
  activeProfile: string | null,
  profiles: { [name: string]: ProfileDraft },
  filePath: string,
): CommunicationConfig {
  if (activeProfile === null) {
    throw new Error(`${filePath}: missing required field 'active_profile'`);
  }
  const profileNames = Object.keys(profiles);
  if (profileNames.length === 0) {
    throw new Error(`${filePath}: missing 'profiles' section or no profiles defined`);
  }
  if (!Object.prototype.hasOwnProperty.call(profiles, activeProfile)) {
    throw new Error(
      `${filePath}: active_profile '${activeProfile}' references undefined profile — available: ${profileNames.join(", ")}`,
    );
  }
  const finalized: { [name: string]: CommunicationProfile } = Object.create(null) as {
    [name: string]: CommunicationProfile;
  };
  for (const name of profileNames) {
    const draft = profiles[name]!;
    if (typeof draft.language !== "string") {
      throw new Error(`${filePath}: profile '${name}' missing required field 'language'`);
    }
    finalized[name] = draft as CommunicationProfile;
  }
  return { active_profile: activeProfile, profiles: finalized };
}
