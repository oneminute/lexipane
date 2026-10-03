import { invoke, isTauri } from "@tauri-apps/api/core";

const providerAccount = (configId: string) =>
  "provider:" + configId + ":api-key";

export async function setProviderApiKey(
  configId: string,
  apiKey: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("Secure provider secrets require the Tauri desktop app.");
  }

  await invoke("secret_set", {
    account: providerAccount(configId),
    secret: apiKey,
  });
}

export async function getProviderApiKey(
  configId: string,
): Promise<string | null> {
  if (!isTauri()) return null;

  return invoke<string | null>("secret_get", {
    account: providerAccount(configId),
  });
}

export async function hasProviderApiKey(
  configId: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  return invoke<boolean>("secret_has", {
    account: providerAccount(configId),
  });
}

export async function deleteProviderApiKey(
  configId: string,
): Promise<void> {
  if (!isTauri()) return;

  await invoke("secret_delete", {
    account: providerAccount(configId),
  });
}
