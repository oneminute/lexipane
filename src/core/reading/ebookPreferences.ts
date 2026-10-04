import { getAppMeta, setAppMeta } from "../settings/appMeta";

export type EbookTheme = "light" | "sepia" | "dark";
export type EpubFlowMode = "scrolled" | "paginated";

export interface EbookReadingPreferences {
  fontScale: number;
  theme: EbookTheme;
  epubFlow: EpubFlowMode;
}

const FONT_KEY = "reader.ebook.font-scale";
const THEME_KEY = "reader.ebook.theme";
const FLOW_KEY = "reader.epub.flow";

export function normalizeEbookFontScale(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(70, Math.min(180, Math.round(parsed / 10) * 10));
}

export function normalizeEbookTheme(value: unknown): EbookTheme {
  return value === "sepia" || value === "dark" ? value : "light";
}

export function normalizeEpubFlow(value: unknown): EpubFlowMode {
  return value === "paginated" ? "paginated" : "scrolled";
}

export async function loadEbookReadingPreferences(): Promise<EbookReadingPreferences> {
  const [fontScale, theme, epubFlow] = await Promise.all([
    getAppMeta(FONT_KEY),
    getAppMeta(THEME_KEY),
    getAppMeta(FLOW_KEY),
  ]);

  return {
    fontScale: normalizeEbookFontScale(fontScale),
    theme: normalizeEbookTheme(theme),
    epubFlow: normalizeEpubFlow(epubFlow),
  };
}

export async function saveEbookFontScale(value: number): Promise<number> {
  const normalized = normalizeEbookFontScale(value);
  await setAppMeta(FONT_KEY, String(normalized));
  return normalized;
}

export async function saveEbookTheme(value: EbookTheme): Promise<void> {
  await setAppMeta(THEME_KEY, normalizeEbookTheme(value));
}

export async function saveEpubFlow(value: EpubFlowMode): Promise<void> {
  await setAppMeta(FLOW_KEY, normalizeEpubFlow(value));
}
