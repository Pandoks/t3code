import { createProviderConfigurationEnvironmentAtoms } from "@t3tools/client-runtime/state/provider-configuration";

import { connectionAtomRuntime } from "../connection/runtime";

export const providerConfigurationEnvironment =
  createProviderConfigurationEnvironmentAtoms(connectionAtomRuntime);
