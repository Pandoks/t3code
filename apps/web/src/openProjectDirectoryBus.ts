import type { EnvironmentId } from "@t3tools/contracts";

const OPEN_PROJECT_DIRECTORY_EVENT = "t3code:open-project-directory";

export interface OpenProjectDirectoryDetail {
  readonly environmentId: EnvironmentId;
  readonly directory: string;
}

export function openProjectDirectory(detail: OpenProjectDirectoryDetail): void {
  window.dispatchEvent(new CustomEvent(OPEN_PROJECT_DIRECTORY_EVENT, { detail }));
}

export function onOpenProjectDirectory(
  listener: (detail: OpenProjectDirectoryDetail) => void,
): () => void {
  const handler = (event: Event) =>
    listener((event as CustomEvent<OpenProjectDirectoryDetail>).detail);
  window.addEventListener(OPEN_PROJECT_DIRECTORY_EVENT, handler);
  return () => window.removeEventListener(OPEN_PROJECT_DIRECTORY_EVENT, handler);
}
