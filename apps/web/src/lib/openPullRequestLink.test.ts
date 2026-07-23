import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  openPullRequestInPreview,
  openPullRequestLink,
  PullRequestLinkOpenError,
} from "./openPullRequestLink";

const previewSupport = vi.hoisted(() => ({ enabled: true }));

vi.mock("../previewStateStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../previewStateStore")>()),
  isPreviewSupportedInRuntime: () => previewSupport.enabled,
}));

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-1",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-07-23T00:00:00.000Z",
};

beforeEach(() => {
  previewSupport.enabled = true;
});

describe("openPullRequestLink", () => {
  it("opens the requested pull request URL", async () => {
    const openExternal = vi.fn(async () => undefined);
    const targetUrl = "https://github.com/pingdotgg/t3code/pull/123";

    await openPullRequestLink({ openExternal }, targetUrl);

    expect(openExternal).toHaveBeenCalledExactlyOnceWith(targetUrl);
  });

  it("reports bridge failures with a safe target origin", async () => {
    const cause = new Error("desktop shell unavailable");
    const targetUrl = "https://github.com/pingdotgg/t3code/pull/123?token=secret";
    const openExternal = vi.fn(async () => Promise.reject(cause));

    const result = openPullRequestLink({ openExternal }, targetUrl);

    await expect(result).rejects.toEqual(
      new PullRequestLinkOpenError({
        targetOrigin: "https://github.com",
        cause,
      }),
    );
    await expect(result).rejects.not.toHaveProperty("message", expect.stringContaining("secret"));
  });
});

describe("openPullRequestInPreview", () => {
  it("opens the pull request in the active thread preview", async () => {
    const openExternal = vi.fn(async () => undefined);
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const targetUrl = "https://github.com/pingdotgg/t3code/pull/123";

    await openPullRequestInPreview({
      threadRef,
      targetUrl,
      openPreview,
      shell: { openExternal },
    });

    expect(openPreview).toHaveBeenCalledExactlyOnceWith({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, url: targetUrl },
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("falls back to the system browser when preview is unsupported", async () => {
    previewSupport.enabled = false;
    const openExternal = vi.fn(async () => undefined);
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const targetUrl = "https://github.com/pingdotgg/t3code/pull/123";

    await openPullRequestInPreview({
      threadRef,
      targetUrl,
      openPreview,
      shell: { openExternal },
    });

    expect(openPreview).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(targetUrl);
  });

  it("falls back to the system browser when opening the preview fails", async () => {
    const openExternal = vi.fn(async () => undefined);
    const openPreview = vi.fn(async () =>
      AsyncResult.failure<PreviewSessionSnapshot, Error>(
        Cause.fail(new Error("preview unavailable")),
      ),
    );
    const targetUrl = "https://github.com/pingdotgg/t3code/pull/123";

    await openPullRequestInPreview({
      threadRef,
      targetUrl,
      openPreview,
      shell: { openExternal },
    });

    expect(openExternal).toHaveBeenCalledExactlyOnceWith(targetUrl);
  });
});
