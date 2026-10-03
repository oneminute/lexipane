import {
  createAiCacheKey,
  getCachedAiValue,
  putCachedAiValue,
} from "./cache";
import { resolveTextTaskRuntimes } from "./runtimeRouter";
import { extractJsonObject } from "./structured";
import { recordAiUsage } from "./usage";
import type { ReadingLevel } from "../reading/preferences";
import {
  listDifficultTermHints,
  listSuppressedTerms,
  normalizeTerm,
} from "../reading/knownTerms";

export type DifficultTermType = "word" | "phrase";

export interface DifficultTerm {
  text: string;
  type: DifficultTermType;
  cefr?: string;
  meaning: string;
  reason?: string;
  confidence: number;
}

interface DifficultyPayload {
  items?: unknown;
}

function normalizePageText(text: string): string {
  return text.replace(/[\s\u00a0]+/g, " ").trim().slice(0, 9000);
}

export function parseDifficultyPayload(
  raw: unknown,
  pageText: string,
): DifficultTerm[] {
  if (!raw || typeof raw !== "object") return [];

  const payload = raw as DifficultyPayload;
  if (!Array.isArray(payload.items)) return [];

  const pageLower = pageText.toLocaleLowerCase("en-US");
  const seen = new Set<string>();
  const result: DifficultTerm[] = [];

  for (const item of payload.items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const text =
      typeof record.text === "string" ? record.text.trim() : "";
    const type =
      record.type === "phrase"
        ? "phrase"
        : record.type === "word"
          ? "word"
          : null;
    const meaning =
      typeof record.meaning === "string" ? record.meaning.trim() : "";
    const confidenceRaw =
      typeof record.confidence === "number" ? record.confidence : 0.7;
    const confidence = Math.max(0, Math.min(1, confidenceRaw));

    if (!text || !type || !meaning) continue;
    if (text.length > 120) continue;
    if (!pageLower.includes(text.toLocaleLowerCase("en-US"))) continue;

    const key = normalizeTerm(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    result.push({
      text,
      type,
      cefr:
        typeof record.cefr === "string"
          ? record.cefr.trim()
          : undefined,
      meaning,
      reason:
        typeof record.reason === "string"
          ? record.reason.trim()
          : undefined,
      confidence,
    });

    if (result.length >= 12) break;
  }

  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function detectDifficultTerms(
  pageText: string,
  level: ReadingLevel,
  bookPath?: string | null,
): Promise<{
  items: DifficultTerm[];
  model: string;
  cached: boolean;
  source?: string;
  fallbackUsed?: boolean;
}> {
  const normalizedPage = normalizePageText(pageText);
  if (normalizedPage.length < 80) {
    return {
      items: [],
      model: "",
      cached: false,
    };
  }

  const [runtimes, suppressed, difficultHints] = await Promise.all([
    resolveTextTaskRuntimes("difficulty", bookPath),
    listSuppressedTerms(),
    listDifficultTermHints(40),
  ]);

  const levelInstruction: Record<ReadingLevel, string> = {
    A2: "The reader is around A2. Include useful B1+ words and multi-word expressions that are likely to interrupt understanding.",
    B1: "The reader is around B1. Focus mainly on B2+ vocabulary, idioms, phrasal verbs, and non-obvious written expressions.",
    B2: "The reader is around B2. Focus mainly on C1+ vocabulary, literary/academic wording, idioms, and phrases whose contextual meaning is not obvious.",
    C1: "The reader is around C1. Only return genuinely advanced, literary, technical, archaic, idiomatic, or context-dependent language.",
  };

  const prompt = [
    "Analyze this English book page for reading obstacles.",
    levelInstruction[level],
    "Return at most 12 high-value items total. Avoid names, transparent compounds, easy words, and duplicate forms.",
    "For phrases, prefer real idioms, phrasal verbs, collocations, or context-dependent expressions rather than arbitrary adjacent words.",
    "Every text value MUST be copied exactly from the supplied page.",
    difficultHints.length > 0
      ? "The reader has previously marked these as difficult. Give extra attention to similar vocabulary or expressions when they actually appear in the page: " +
        difficultHints.join(", ")
      : "",
    "Return ONLY valid JSON with this shape:",
    '{"items":[{"text":"exact text","type":"word|phrase","cefr":"B2|C1|C2|unknown","meaning":"short Simplified Chinese meaning in this context","reason":"short reason it may block reading","confidence":0.0}]}',
    "",
    "PAGE:",
    normalizedPage,
  ]
    .filter(Boolean)
    .join("\n");

  const errors: string[] = [];

  for (let index = 0; index < runtimes.length; index += 1) {
    const runtime = runtimes[index];
    const cacheInput = {
      level,
      page: normalizedPage,
      schema: 3,
    };
    const cacheKey = createAiCacheKey(
      "difficulty",
      runtime.cacheModelKey,
      cacheInput,
    );
    const cached =
      await getCachedAiValue<{ items: DifficultTerm[] }>(cacheKey);

    if (cached) {
      return {
        items: cached.items.filter(
          (item) => !suppressed.has(normalizeTerm(item.text)),
        ),
        model: runtime.model,
        cached: true,
        source: runtime.label,
        fallbackUsed: index > 0,
      };
    }

    try {
      const started = Date.now();
      const response = await runtime.provider.generateText({
        model: runtime.model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You are LexiPane's reading-difficulty detector. Be selective and context-aware. Return JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });
      const latencyMs = Date.now() - started;

      const parsed = extractJsonObject(response.text);
      const items = parseDifficultyPayload(
        parsed,
        normalizedPage,
      ).filter(
        (item) => !suppressed.has(normalizeTerm(item.text)),
      );

      await Promise.all([
        recordAiUsage(
          runtime.model,
          "difficulty",
          response.usage,
          latencyMs,
          runtime.providerConfigId,
        ),
        putCachedAiValue(
          cacheKey,
          "difficulty",
          runtime.cacheModelKey,
          { items },
        ),
      ]);

      return {
        items,
        model: response.model || runtime.model,
        cached: false,
        source: runtime.label,
        fallbackUsed: index > 0,
      };
    } catch (error) {
      errors.push(runtime.label + " — " + errorMessage(error));
    }
  }

  throw new Error(
    "All difficulty-analysis routes failed. " + errors.join(" | "),
  );
}
