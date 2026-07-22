import { WS_METHODS } from "@t3tools/contracts";

import type { ExternalChatServiceShape } from "./ExternalChatService.ts";

export function makeExternalChatRpcHandlers(service: ExternalChatServiceShape) {
  return {
    [WS_METHODS.externalChatsList]: service.list,
    [WS_METHODS.externalChatsRefresh]: service.refresh,
    [WS_METHODS.externalChatsImport]: service.import,
  } as const;
}
