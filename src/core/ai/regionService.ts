import {
  createAiCacheKey,
  getCachedAiValue,
  putCachedAiValue,
  stableHash,
} from "./cache";
import { resolveTextTaskRuntimes } from "./runtimeRouter";
import { recordAiUsage } from "./usage";

export interface RegionAnalysisResult {
  text: string;
  model: string;
  cached: boolean;
  source?: string;
  fallbackUsed?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function analyzeRegionImage(
  imageDataUrl: string,
  pageContext: string,
  question?: string,
  bookPath?: string | null,
): Promise<RegionAnalysisResult> {
  const runtimes = await resolveTextTaskRuntimes("region", bookPath);

  const trimmedContext = pageContext
    .replace(/[\s\u00a0]+/g, " ")
    .trim()
    .slice(0, 5000);

  const cacheInput = {
    imageHash: stableHash(imageDataUrl),
    pageContext: trimmedContext,
    question: question?.trim() ?? "",
    promptVersion: 3,
  };

  const prompt = [
    "You are LexiPane, a contextual reading assistant.",
    "Analyze the selected image region from an English book or PDF.",
    "Answer primarily in Simplified Chinese while preserving useful English terms.",
    "If it contains text, explain the text in context.",
    "If it contains a chart, diagram, formula, table, or illustration, explain what the reader needs to understand.",
    "Do not invent details that are not visible.",
    question?.trim()
      ? "Reader question: " + question.trim()
      : "",
    trimmedContext
      ? "Nearby reading context: " + trimmedContext
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const errors: string[] = [];

  for (let index = 0; index < runtimes.length; index += 1) {
    const runtime = runtimes[index];

    if (!runtime.provider.generateVision) {
      errors.push(runtime.label + " — no vision capability");
      continue;
    }

    const cacheKey = createAiCacheKey(
      "region",
      runtime.cacheModelKey,
      cacheInput,
    );
    const cached = await getCachedAiValue<{ text: string }>(cacheKey);

    if (cached?.text) {
      return {
        text: cached.text,
        model: runtime.model,
        cached: true,
        source: runtime.label,
        fallbackUsed: index > 0,
      };
    }

    try {
      const started = Date.now();
      const response = await runtime.provider.generateVision({
        model: runtime.model,
        prompt,
        imageDataUrl,
      });
      const latencyMs = Date.now() - started;
      const text = response.text.trim();

      if (!text) {
        throw new Error("Vision model returned an empty response.");
      }

      await Promise.all([
        recordAiUsage(
          runtime.model,
          "region",
          response.usage,
          latencyMs,
          runtime.providerConfigId,
        ),
        putCachedAiValue(
          cacheKey,
          "region",
          runtime.cacheModelKey,
          { text },
        ),
      ]);

      return {
        text,
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
    "All region/image routes failed. " + errors.join(" | "),
  );
}
