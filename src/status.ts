export type TaskStatus = "open" | "running" | "done" | "failed";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
}

export function isFinished(task: Task): boolean {
  return task.status === "done" || task.status === "failed";
}

export function countByStatus(tasks: readonly Task[], status: TaskStatus): number {
  return tasks.filter((task) => task.status === status).length;
}
