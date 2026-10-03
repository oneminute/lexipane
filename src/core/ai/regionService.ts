import {
  createAiCacheKey,
  getCachedAiValue,
  putCachedAiValue,
  stableHash,
} from "./cache";
import { resolveTextTaskRuntime } from "./runtimeRouter";
import { recordAiUsage } from "./usage";

export interface RegionAnalysisResult {
  text: string;
  model: string;
  cached: boolean;
  source?: string;
}

export async function analyzeRegionImage(
  imageDataUrl: string,
  pageContext: string,
  question?: string,
): Promise<RegionAnalysisResult> {
  const runtime = await resolveTextTaskRuntime("region");

  if (!runtime.provider.generateVision) {
    throw new Error(
      runtime.label +
        " does not expose image/vision generation through its LexiPane adapter.",
    );
  }

  const trimmedContext = pageContext
    .replace(/[\s\u00a0]+/g, " ")
    .trim()
    .slice(0, 5000);

  const cacheInput = {
    imageHash: stableHash(imageDataUrl),
    pageContext: trimmedContext,
    question: question?.trim() ?? "",
    promptVersion: 2,
  };
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
    };
  }

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

  const started = Date.now();
  const response = await runtime.provider.generateVision({
    model: runtime.model,
    prompt,
    imageDataUrl,
  });
  const latencyMs = Date.now() - started;
  const text = response.text.trim();

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
  };
}
