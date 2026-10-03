import { getAppMeta, setAppMeta } from "../settings/appMeta";

export type ReadingLevel = "A2" | "B1" | "B2" | "C1";

const READING_LEVEL_KEY = "reading.level";
export const DEFAULT_READING_LEVEL: ReadingLevel = "B2";

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
