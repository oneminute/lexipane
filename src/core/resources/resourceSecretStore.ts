import { invoke, isTauri } from "@tauri-apps/api/core";

function resourceAccountSecret(
  providerId: string,
  accountId: string,
): string {
  return (
    "resource:" +
    providerId.trim().toLowerCase() +
    ":" +
    accountId.trim() +
    ":access-token"
  );
}

export async function setResourceAccountToken(
  providerId: string,
  accountId: string,
  token: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error(
      "Secure resource-account tokens require the desktop application.",
    );
  }

  await invoke("secret_set", {
    account: resourceAccountSecret(providerId, accountId),
    secret: token,
  });
}

export async function getResourceAccountToken(
  providerId: string,
  accountId: string,
): Promise<string | null> {
  if (!isTauri()) return null;

  return invoke<string | null>("secret_get", {
    account: resourceAccountSecret(providerId, accountId),
  });
}

export async function hasResourceAccountToken(
  providerId: string,
  accountId: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  return invoke<boolean>("secret_has", {
    account: resourceAccountSecret(providerId, accountId),
  });
}

export async function deleteResourceAccountToken(
  providerId: string,
  accountId: string,
): Promise<void> {
  if (!isTauri()) return;

  await invoke("secret_delete", {
    account: resourceAccountSecret(providerId, accountId),
  });
}
