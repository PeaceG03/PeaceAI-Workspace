export function doneTitles(tasks: { title: string; done: boolean }[]): string[] {
  return tasks.filter((x) => x.done).map((x) => x.title);
}
