import { WS_METHODS } from "@t3tools/contracts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

const scheduler = createAtomCommandScheduler();

export const externalChatEnvironment = {
  list: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:external-chats:list",
    tag: WS_METHODS.externalChatsList,
    staleTimeMs: 15_000,
  }),
  refresh: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:external-chats:refresh",
    tag: WS_METHODS.externalChatsRefresh,
    scheduler,
    concurrency: {
      mode: "singleFlight",
      key: ({ environmentId }) => environmentId,
    },
  }),
  import: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:external-chats:import",
    tag: WS_METHODS.externalChatsImport,
    scheduler,
    concurrency: {
      mode: "serial",
      key: ({ environmentId }) => environmentId,
    },
  }),
};
