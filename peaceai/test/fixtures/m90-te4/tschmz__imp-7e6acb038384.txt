import type { Command, Option } from "commander";

export function registerCompletionCommands(program: Command): void {
  const completionCommand = program.command("completion").description("Generate shell completion scripts");

  completionCommand
    .command("bash")
    .description("Print bash completion script")
    .action(() => {
      process.stdout.write(createBashCompletionScript());
    });

  completionCommand
    .command("complete [words...]", { hidden: true })
    .allowUnknownOption()
    .description("Print completion candidates")
    .action((words: string[] = []) => {
      const completions = completeCliWords(program, words);

      if (completions.length > 0) {
        process.stdout.write(`${completions.join("\n")}\n`);
      }
    });
}

export function createBashCompletionScript(commandName = "imp"): string {
  return `# bash completion for ${commandName}
_${commandName}_completion()
{
  local command="\${COMP_WORDS[0]}"
  local words=("\${COMP_WORDS[@]:1}")
  COMPREPLY=()

  local completion
  while IFS= read -r completion; do
    [[ -n "$completion" ]] && COMPREPLY+=("$completion")
  done < <("$command" completion complete -- "\${words[@]}" 2>/dev/null)
}

complete -o default -F _${commandName}_completion ${commandName}
`;
}

export function completeCliWords(root: Command, words: readonly string[]): string[] {
  const current = words.at(-1) ?? "";
  const completedWords = words.length > 0 ? words.slice(0, -1) : [];
  const context = resolveCompletionContext(root, completedWords);

  if (context.pendingOption) {
    return filterAndSort(optionChoices(context.pendingOption), current);
  }

  return filterAndSort(collectCandidates(context.command, current), current);
}

type CompletionContext = {
  command: Command;
  pendingOption?: Option;
};

function resolveCompletionContext(root: Command, words: readonly string[]): CompletionContext {
  let command = root;
  let pendingOption: Option | undefined;

  for (const word of words) {
    if (pendingOption) {
      pendingOption = undefined;
      continue;
    }

    if (word.startsWith("-")) {
      const option = findOption(command, word);

      if (option && optionConsumesFollowingValue(option, word)) {
        pendingOption = option;
      }

      continue;
    }

    const subcommand = findSubcommand(command, word);

    if (subcommand) {
      command = subcommand;
      continue;
    }

    if (word === "help") {
      continue;
    }
  }

  return { command, pendingOption };
}

function collectCandidates(command: Command, current: string): string[] {
  const candidates: string[] = [];
  const subcommands = visibleSubcommands(command).map((subcommand) => subcommand.name());

  if (!current.startsWith("-")) {
    candidates.push(...subcommands);
  }

  if (current === "" || current.startsWith("-") || subcommands.length === 0) {
    candidates.push(...visibleOptions(command).flatMap((option) => optionNames(option)));
  }

  return candidates;
}

function visibleSubcommands(command: Command): Command[] {
  return command.createHelp().visibleCommands(command);
}

function findSubcommand(command: Command, name: string): Command | undefined {
  return visibleSubcommands(command).find((subcommand) => subcommand.name() === name);
}

function visibleOptions(command: Command): Option[] {
  return command.createHelp().visibleOptions(command);
}

function findOption(command: Command, word: string): Option | undefined {
  const optionName = word.includes("=") ? word.slice(0, word.indexOf("=")) : word;

  return visibleOptions(command).find((option) => option.long === optionName || option.short === optionName);
}

function optionConsumesFollowingValue(option: Option, word: string): boolean {
  return !word.includes("=") && (option.required || option.optional || option.variadic);
}

function optionChoices(option: Option): string[] {
  return option.argChoices ?? [];
}

function optionNames(option: Option): string[] {
  return [option.long, option.short].filter((name): name is string => name !== undefined);
}

function filterAndSort(candidates: readonly string[], current: string): string[] {
  return [...new Set(candidates)].filter((candidate) => candidate.startsWith(current)).sort();
}
