import { crossSpaceRequestReference } from "@cohub/core/references";
import type { Context } from "hono";
import { routePath } from "hono/route";
import { enqueueReferences } from "../reference-index-queue.js";
import { getRequestSource } from "./request-source.js";
import { requireValidId } from "./middleware.js";

const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;

/** Enqueue a cross-space tool_call when source headers target another space. */
export const maybeEnqueueCrossSpaceReference = (
  c: Context,
  targetSpaceId: string | undefined | null,
): void => {
  if (!targetSpaceId || !requireValidId(targetSpaceId)) return;
  if (!isSuccessStatus(c.res.status)) return;

  const requestSource = getRequestSource(c);
  let pattern: string | undefined;
  try {
    const registered = routePath(c, -1);
    if (registered && registered !== "*" && registered !== "/*") {
      pattern = registered;
    }
  } catch {
    // ignore
  }

  const reference = crossSpaceRequestReference({
    requestSource,
    targetSpaceId,
    route: {
      method: c.req.method,
      path: c.req.path,
      ...(pattern ? { pattern } : {}),
    },
  });
  if (!reference) return;
  enqueueReferences([reference]);
};
