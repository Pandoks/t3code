import type { LocalApi, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { type MouseEvent, useCallback } from "react";

import { openUrlInPreview, type OpenPreviewMutation } from "../browser/openFileInPreview";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readLocalApi } from "../localApi";
import { isPreviewSupportedInRuntime } from "../previewStateStore";

export class PullRequestLinkOpenError extends Schema.TaggedErrorClass<PullRequestLinkOpenError>()(
  "PullRequestLinkOpenError",
  {
    targetOrigin: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  static fromCause(targetUrl: string, cause: unknown): PullRequestLinkOpenError {
    let targetOrigin: string | null = null;
    try {
      targetOrigin = new URL(targetUrl).origin;
    } catch {
      // Keep malformed URLs out of diagnostics while preserving the open failure below.
    }
    return new PullRequestLinkOpenError({ targetOrigin, cause });
  }

  override get message(): string {
    return this.targetOrigin === null
      ? "Unable to open pull request link."
      : `Unable to open pull request link at ${this.targetOrigin}.`;
  }
}

export async function openPullRequestLink(
  shell: Pick<LocalApi["shell"], "openExternal">,
  targetUrl: string,
): Promise<void> {
  try {
    await shell.openExternal(targetUrl);
  } catch (cause) {
    throw PullRequestLinkOpenError.fromCause(targetUrl, cause);
  }
}

export async function openPullRequestInPreview<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly targetUrl: string;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly shell: Pick<LocalApi["shell"], "openExternal">;
}): Promise<void> {
  if (isPreviewSupportedInRuntime() && input.threadRef.threadId.length > 0) {
    const result = await openUrlInPreview({
      threadRef: input.threadRef,
      url: input.targetUrl,
      openPreview: input.openPreview,
    });
    if (result._tag === "Success") {
      return;
    }
  }

  await openPullRequestLink(input.shell, input.targetUrl);
}

/**
 * Returns a click handler that opens a pull request URL in the system browser.
 *
 * Stops event propagation/default so activating the link does not also trigger
 * an enclosing row or trigger (e.g. opening the branch dropdown), and surfaces a
 * toast when the local API is unavailable or the open fails.
 */
export function useOpenPrLink() {
  return useCallback((event: MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void openPullRequestLink(api.shell, prUrl).catch((error) => {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  }, []);
}
