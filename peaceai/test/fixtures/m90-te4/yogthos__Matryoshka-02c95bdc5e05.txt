/**
 * Error Analyzer with Levenshtein Distance Suggestions
 * Provides intelligent feedback to help LLM correct mistakes
 */

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const MAX_STR_LENGTH = 1_000;
  if (a.length > MAX_STR_LENGTH) a = a.slice(0, MAX_STR_LENGTH);
  if (b.length > MAX_STR_LENGTH) b = b.slice(0, MAX_STR_LENGTH);
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find similar strings using Levenshtein distance
 */
export function findSimilar(
  input: string,
  candidates: string[],
  maxDistance: number = 3,
  maxResults: number = 5
): Array<{ value: string; distance: number }> {
  if (!Number.isFinite(maxDistance) || maxDistance < 0) maxDistance = 3;
  if (!Number.isFinite(maxResults) || maxResults < 1) maxResults = 5;
  maxResults = Math.min(Math.floor(maxResults), 1000);
  const MAX_CANDIDATES = 10_000;
  if (candidates.length > MAX_CANDIDATES) candidates = candidates.slice(0, MAX_CANDIDATES);
  const results = candidates
    .map(candidate => ({
      value: candidate,
      distance: levenshteinDistance(input.toLowerCase(), candidate.toLowerCase()),
    }))
    .filter(r => r.distance <= maxDistance)
    .sort((a, b) => {
      if (a.distance < b.distance) return -1;
      if (a.distance > b.distance) return 1;
      return 0;
    })
    .slice(0, maxResults);

  return results;
}

/**
 * Known valid regex flags
 */
const VALID_REGEX_FLAGS = ["g", "i", "m", "s", "u", "y"];

/**
 * Known sandbox functions
 */
const SANDBOX_FUNCTIONS = [
  "grep",
  "fuzzy_search",
  "text_stats",
  "locate_line",
  "count_tokens",
  "llm_query",
  "batch_llm_query",
  "synthesize_regex",
  "synthesize_extractor",
  "get_extractor_code",
  "test_regex",
  "extract_with_regex",
];

/**
 * Known sandbox variables
 */
const SANDBOX_VARIABLES = [
  "context",
  "memory",
  "console",
  "JSON",
  "Math",
  "Array",
  "Object",
  "String",
  "Number",
  "RegExp",
  "Map",
  "Set",
  "parseInt",
  "parseFloat",
];

/**
 * Error analysis result
 */
export interface ErrorAnalysis {
  originalError: string;
  errorType: string;
  problematicValue?: string;
  suggestions: string[];
  explanation: string;
  correctedCode?: string;
}

/**
 * Analyze an error and provide suggestions
 */
export function analyzeError(
  error: string,
  code?: string,
  availableVars: string[] = []
): ErrorAnalysis {
  // Invalid regex flags error
  const flagsMatch = error.match(/Invalid flags supplied to RegExp constructor '([^']+)'/);
  if (flagsMatch) {
    return analyzeInvalidFlags(flagsMatch[1], code);
  }

  // Undefined variable error
  const undefinedMatch = error.match(/(\w+) is not defined/);
  if (undefinedMatch) {
    return analyzeUndefinedVariable(undefinedMatch[1], availableVars);
  }

  // Property of undefined error
  const propertyMatch = error.match(/Cannot read propert(?:y|ies) of undefined \(reading '([^']+)'\)/);
  if (propertyMatch) {
    return analyzePropertyOfUndefined(propertyMatch[1], code);
  }

  // Function not found error - check for string method on object
  const notFunctionMatch = error.match(/(\w+) is not a function/);
  if (notFunctionMatch) {
    const methodName = notFunctionMatch[1];
    // Check if it's a string method being called on grep result
    if (["match", "split", "replace", "slice", "substring", "substr", "indexOf", "includes"].includes(methodName)) {
      return analyzeStringMethodOnObject(methodName);
    }
    return analyzeNotAFunction(methodName);
  }

  // Invalid regex pattern - also matches SyntaxError with regex
  const regexSyntaxMatch = error.match(/Invalid regular expression: \/([^/]+)\//);
  if (regexSyntaxMatch) {
    return analyzeInvalidRegex(regexSyntaxMatch[1]);
  }

  // SyntaxError with regex mention
  if (error.toLowerCase().includes("syntaxerror") && error.toLowerCase().includes("regular expression")) {
    return analyzeInvalidRegex("");
  }

  // Generic error
  return {
    originalError: error,
    errorType: "unknown",
    suggestions: [],
    explanation: `Error occurred: ${error}`,
  };
}

/**
 * Analyze string method called on object (grep result)
 */
function analyzeStringMethodOnObject(methodName: string): ErrorAnalysis {
  return {
    originalError: `${methodName} is not a function`,
    errorType: "string_method_on_object",
    problematicValue: methodName,
    suggestions: [
      `grep() returns objects with { match, line, lineNum }, not strings.`,
      `Use hit.line to get the string:`,
      `  for (const hit of hits) {`,
      `    const result = hit.line.${methodName}(...);`,
      `  }`,
      `Or use extract_with_regex() for pattern extraction.`,
    ],
    explanation: `You called .${methodName}() on a grep result object.
grep() returns objects like: { match: "...", line: "full line", lineNum: 123 }

To use string methods, access the .line property:
  hit.line.${methodName}(...)

Better approach - use the synthesis tools:
  const value = extract_with_regex(pattern, hit.line);`,
  };
}

/**
 * Analyze invalid regex flags
 */
function analyzeInvalidFlags(invalidFlags: string, code?: string): ErrorAnalysis {
  // The flags likely contain a word that was meant to be a pattern
  // e.g., "regionm" where "region" was meant to be a search pattern

  // Check if it looks like a word + flags
  const possibleWord = invalidFlags.replace(/[gimsuy]+$/, "");
  const actualFlags = invalidFlags.slice(possibleWord.length);

  if (possibleWord.length > 1) {
    // This looks like grep("pattern1", "pattern2") where pattern2 became flags
    return {
      originalError: `Invalid flags '${invalidFlags}'`,
      errorType: "invalid_regex_flags",
      problematicValue: invalidFlags,
      suggestions: [
        `grep("${possibleWord}") - search for "${possibleWord}"`,
        `grep("pattern1|${possibleWord}") - search for either pattern`,
        `grep("pattern1.*${possibleWord}") - search for pattern1 followed by ${possibleWord}`,
      ],
      explanation: `It looks like "${possibleWord}" was passed as the second argument to grep().
The grep() function signature is: grep(pattern, flags?)
- pattern: regex pattern string (required)
- flags: optional regex flags like "i" for case-insensitive

If you want to search for multiple patterns, use the | operator:
  grep("sales|region") - matches lines with "sales" OR "region"
  grep("SALES_DATA") - matches lines containing "SALES_DATA"

Valid regex flags are: ${VALID_REGEX_FLAGS.join(", ")}`,
    };
  }

  // Just invalid flags
  const validSuggestions = VALID_REGEX_FLAGS.filter(f => !actualFlags.includes(f));
  return {
    originalError: `Invalid flags '${invalidFlags}'`,
    errorType: "invalid_regex_flags",
    problematicValue: invalidFlags,
    suggestions: [
      `Valid flags: ${VALID_REGEX_FLAGS.join(", ")}`,
      `Common usage: grep("pattern", "gi") for global, case-insensitive`,
    ],
    explanation: `Invalid regex flags: "${invalidFlags}". Valid flags are: ${VALID_REGEX_FLAGS.join(", ")}`,
  };
}

/**
 * Analyze undefined variable
 */
function analyzeUndefinedVariable(
  varName: string,
  availableVars: string[]
): ErrorAnalysis {
  const allKnown = [...SANDBOX_FUNCTIONS, ...SANDBOX_VARIABLES, ...availableVars];
  const similar = findSimilar(varName, allKnown, 3, 5);

  const suggestions: string[] = [];

  if (similar.length > 0) {
    suggestions.push(`Did you mean: ${similar.map(s => `"${s.value}"`).join(", ")}?`);
  }

  // Check if it's a common mistake
  if (varName === "hits" || varName === "results" || varName === "data") {
    suggestions.push(
      `Variable "${varName}" is not defined. You need to assign it first:`,
      `  const ${varName} = grep("your_pattern");`
    );
  }

  suggestions.push(
    `Available functions: ${SANDBOX_FUNCTIONS.slice(0, 5).join(", ")}...`,
    `Use grep() to search, then store results in a variable.`
  );

  return {
    originalError: `${varName} is not defined`,
    errorType: "undefined_variable",
    problematicValue: varName,
    suggestions,
    explanation: `The variable "${varName}" has not been defined.
${similar.length > 0 ? `Similar names: ${similar.map(s => s.value).join(", ")}` : ""}

Variables declared with const/let in a previous turn may not persist.
Make sure to define your variable in the same code block where you use it.`,
  };
}

/**
 * Analyze property of undefined error
 */
function analyzePropertyOfUndefined(property: string, code?: string): ErrorAnalysis {
  return {
    originalError: `Cannot read property '${property}' of undefined`,
    errorType: "property_of_undefined",
    problematicValue: property,
    suggestions: [
      `The object you're accessing is undefined.`,
      `Check that the variable is defined and contains data.`,
      `Add a null check: if (obj && obj.${property}) { ... }`,
      `For arrays: if (arr && arr.length > 0) { arr.${property}(...) }`,
    ],
    explanation: `You tried to access "${property}" on an undefined value.
This usually means:
1. A previous grep() or search returned no results
2. A variable from a previous turn is no longer defined
3. The data structure is different than expected

Fix: Always check if variables exist before using them:
  const hits = grep("pattern");
  if (hits && hits.length > 0) {
    // safe to use hits.${property}
  }`,
  };
}

/**
 * Analyze "not a function" error
 */
function analyzeNotAFunction(name: string): ErrorAnalysis {
  const similar = findSimilar(name, SANDBOX_FUNCTIONS, 3, 5);

  const suggestions: string[] = [];

  if (similar.length > 0) {
    suggestions.push(`Did you mean: ${similar.map(s => `${s.value}()`).join(", ")}?`);
  }

  suggestions.push(
    `Available functions:`,
    `  grep(pattern) - search document`,
    `  synthesize_extractor([{input, output}, ...]) - create extractor from examples`,
    `  synthesize_regex([strings], [negatives]) - create regex from examples`,
    `  extract_with_regex(pattern, string) - extract using regex`,
  );

  return {
    originalError: `${name} is not a function`,
    errorType: "not_a_function",
    problematicValue: name,
    suggestions,
    explanation: `"${name}" is not a function.
${similar.length > 0 ? `Similar functions: ${similar.map(s => s.value).join(", ")}` : ""}

This might mean:
1. Typo in the function name
2. The variable holds data, not a function
3. The function doesn't exist in this context`,
  };
}

/**
 * Analyze invalid regex pattern
 */
function analyzeInvalidRegex(pattern: string): ErrorAnalysis {
  const issues: string[] = [];

  // Common regex mistakes
  if (pattern.includes("[") && !pattern.includes("]")) {
    issues.push("Unclosed character class [");
  }
  if (pattern.includes("(") && !pattern.includes(")")) {
    issues.push("Unclosed group (");
  }
  if (pattern.includes("{") && !pattern.includes("}")) {
    issues.push("Unclosed quantifier {");
  }
  if (/[+*?]{2,}/.test(pattern)) {
    issues.push("Multiple consecutive quantifiers");
  }
  if (pattern.endsWith("\\")) {
    issues.push("Trailing backslash");
  }

  // Special characters that need escaping
  const specialChars = ["$", ".", "*", "+", "?", "^", "[", "]", "(", ")", "{", "}", "|", "\\"];
  const unescaped = specialChars.filter(c => {
    const idx = pattern.indexOf(c);
    return idx >= 0 && (idx === 0 || pattern[idx - 1] !== "\\");
  });

  if (unescaped.length > 0) {
    issues.push(`Characters that may need escaping: ${unescaped.join(" ")}`);
  }

  return {
    originalError: `Invalid regular expression: /${pattern}/`,
    errorType: "invalid_regex",
    problematicValue: pattern,
    suggestions: [
      ...issues,
      `Use synthesize_regex() to automatically create valid patterns:`,
      `  const regex = synthesize_regex(["example1", "example2"]);`,
      `Special characters need escaping: \\$ \\. \\* \\+ \\? \\^ \\[ \\]`,
    ],
    explanation: `The regex pattern "/${pattern}/" is invalid.
${issues.length > 0 ? `Issues found:\n${issues.map(i => `  - ${i}`).join("\n")}` : ""}

TIP: Instead of writing regex manually, use the synthesis tools:
  const regex = synthesize_regex(["$1,000", "$2,500"]);
  // Returns a pattern that matches these examples`,
  };
}

/**
 * Format error analysis as feedback string
 */
export function formatErrorFeedback(analysis: ErrorAnalysis): string {
  const lines: string[] = [
    `Error: ${analysis.originalError}`,
    "",
    analysis.explanation,
    "",
  ];

  if (analysis.suggestions.length > 0) {
    lines.push("Suggestions:");
    for (const suggestion of analysis.suggestions) {
      lines.push(`  ${suggestion}`);
    }
  }

  return lines.join("\n");
}
