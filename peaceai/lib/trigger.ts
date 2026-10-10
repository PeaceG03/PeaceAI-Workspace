// Pure mirror of the workflow trigger gate, so it can be unit tested.
export const OWNER = "PeaceG03";
export const TASK_LABEL = "peace-task";

export interface TriggerInput {
  eventName: string;
  action: string | undefined;
  labelName: string | undefined;
  issueAuthor: string | undefined;
  sender: string | undefined;
  enabled: string | undefined;
  repository: string | undefined;
}

export function shouldRunTask(input: TriggerInput): boolean {
  return (
    input.eventName === "issues" &&
    input.action === "labeled" &&
    input.labelName === TASK_LABEL &&
    input.issueAuthor === OWNER &&
    input.sender === OWNER &&
    input.enabled === "true" &&
    input.repository === `${OWNER}/PeaceAI-Workspace`
  );
}

/** Kill switch re-check inside Job A: anything other than the literal "true" stops the job. */
export function killSwitchAllows(enabled: string | undefined): boolean {
  return enabled === "true";
}
