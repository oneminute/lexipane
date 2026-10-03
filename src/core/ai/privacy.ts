import { getAppMeta, setAppMeta } from "../settings/appMeta";

export type AiPrivacyMode =
  | "local-only"
  | "prefer-local"
  | "automatic"
  | "cloud-only";

const KEY = "ai.privacy.mode";

export async function loadAiPrivacyMode(): Promise<AiPrivacyMode> {
  const value = await getAppMeta(KEY);
  if (
    value === "local-only" ||
    value === "prefer-local" ||
    value === "automatic" ||
    value === "cloud-only"
  ) {
    return value;
  }

  return "prefer-local";
}

export async function saveAiPrivacyMode(
  mode: AiPrivacyMode,
): Promise<void> {
  await setAppMeta(KEY, mode);
}
