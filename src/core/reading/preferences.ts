import { APP_DEFAULTS } from "../../config/appDefaults";
import { getAppMeta, setAppMeta } from "../settings/appMeta";

export type ReadingLevel = "A2" | "B1" | "B2" | "C1";

const READING_LEVEL_KEY = "reading.level";
const SENTENCE_PREFETCH_COUNT_KEY = "reading.ai.sentence-prefetch-count";

export const DEFAULT_READING_LEVEL: ReadingLevel =
  APP_DEFAULTS.reading.level;
export const DEFAULT_SENTENCE_PREFETCH_COUNT =
  APP_DEFAULTS.reading.ai.sentencePrefetchCount;

export const readingLevels: Array<{
  id: ReadingLevel;
  label: string;
  description: string;
}> = [
  {
    id: "A2",
    label: "Elementary · A2",
    description: "Mark many uncommon words and everyday phrases.",
  },
  {
    id: "B1",
    label: "Intermediate · B1",
    description: "Mark vocabulary and phrases above everyday intermediate English.",
  },
  {
    id: "B2",
    label: "Upper intermediate · B2",
    description: "Focus on less common vocabulary, idioms, and dense written phrases.",
  },
  {
    id: "C1",
    label: "Advanced · C1",
    description: "Only mark genuinely difficult, literary, technical, or idiomatic language.",
  },
];

export function isReadingLevel(value: string | null): value is ReadingLevel {
  return value === "A2" || value === "B1" || value === "B2" || value === "C1";
}

export async function loadReadingLevel(): Promise<ReadingLevel> {
  const stored = await getAppMeta(READING_LEVEL_KEY);
  return isReadingLevel(stored) ? stored : DEFAULT_READING_LEVEL;
}

export async function saveReadingLevel(level: ReadingLevel): Promise<void> {
  await setAppMeta(READING_LEVEL_KEY, level);
}


export function normalizeSentencePrefetchCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SENTENCE_PREFETCH_COUNT;
  return Math.max(0, Math.min(10, Math.trunc(value)));
}

export async function loadSentencePrefetchCount(): Promise<number> {
  const stored = await getAppMeta(SENTENCE_PREFETCH_COUNT_KEY);
  if (stored === null) return DEFAULT_SENTENCE_PREFETCH_COUNT;

  const parsed = Number(stored);
  return Number.isFinite(parsed)
    ? normalizeSentencePrefetchCount(parsed)
    : DEFAULT_SENTENCE_PREFETCH_COUNT;
}

export async function saveSentencePrefetchCount(
  count: number,
): Promise<void> {
  await setAppMeta(
    SENTENCE_PREFETCH_COUNT_KEY,
    String(normalizeSentencePrefetchCount(count)),
  );
}
