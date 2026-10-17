import type { Api as AiApi, Model } from "@mariozechner/pi-ai";
import type { ConversationAssistantMessage, ConversationEvent } from "../domain/conversation.js";

interface PreviousResponseState {
  previousResponseId?: string;
  conversationMessages: ConversationEvent[];
}

export function resolvePreviousResponseState(
  messages: ConversationEvent[],
  model: Pick<Model<AiApi>, "api" | "provider" | "baseUrl">,
): PreviousResponseState {
  if (!supportsPreviousResponseId(model)) {
    return { conversationMessages: messages };
  }

  const latestAssistant = findLatestAssistantMessage(messages);
  if (
    !latestAssistant ||
    latestAssistant.api !== model.api ||
    latestAssistant.provider !== model.provider ||
    !latestAssistant.responseId ||
    latestAssistant.stopReason === "error" ||
    latestAssistant.stopReason === "aborted"
  ) {
    return { conversationMessages: messages };
  }

  const assistantIndex = messages.lastIndexOf(latestAssistant);

  return {
    previousResponseId: latestAssistant.responseId,
    conversationMessages: messages.slice(assistantIndex + 1),
  };
}

export function supportsPreviousResponseId(
  model: Pick<Model<AiApi>, "api" | "provider" | "baseUrl">,
): boolean {
  if (model.api === "azure-openai-responses") {
    return model.provider === "azure-openai-responses";
  }

  if (model.api === "openai-codex-responses") {
    return model.provider === "openai-codex";
  }

  if (model.api !== "openai-responses" || model.provider !== "openai") {
    return false;
  }

  return isOfficialOpenAiBaseUrl(model.baseUrl);
}

function isOfficialOpenAiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function findLatestAssistantMessage(
  messages: ConversationEvent[],
): ConversationAssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return message;
    }
  }

  return undefined;
}
