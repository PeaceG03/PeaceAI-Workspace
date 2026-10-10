// Display theme settings. The default theme is a typed object literal used by the label helper.
export type Theme = {
  readonly name: string;
  readonly dark: boolean;
};

export const DEFAULT_THEME: Theme = {
  name: "plain",
  dark: false,
};

export function themeLabel(theme: Theme): string {
  return theme.dark ? `${theme.name} (dark)` : theme.name;
}
