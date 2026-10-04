import {
  createAiCacheKey,
  getCachedAiValue,
  putCachedAiValue,
  stableHash,
} from "./cache";
import { runWithAiExecutionPolicy } from "./executionPolicy";
import {
  formatStructuredRegionAnalysis,
  parseStructuredRegionAnalysis,
  regionOutputInstruction,
  type RegionAnalysis,
} from "./readingStructured";
import { resolveTextTaskRuntimes } from "./runtimeRouter";
import { recordAiUsage } from "./usage";

export interface RegionAnalysisResult {
  text: string;
  analysis: RegionAnalysis;
  model: string;
  cached: boolean;
  source?: string;
  fallbackUsed?: boolean;
  attemptedSources?: string[];
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
    promptVersion: 4,
  };

  const prompt = [
    "You are LexiPane, a contextual reading assistant.",
    "Analyze the selected image region from an English book or PDF.",
    "Answer primarily in Simplified Chinese while preserving useful English terms.",
    "If it contains text, explain the text in context.",
    "If it contains a chart, diagram, formula, table, or illustration, explain what the reader needs to understand.",
    "Do not invent details that are not visible.",
    regionOutputInstruction(),
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
  const attemptedSources: string[] = [];

  for (let index = 0; index < runtimes.length; index += 1) {
    const runtime = runtimes[index];

    if (!runtime.provider.generateVision) {
      const detail = runtime.label + " — no vision implementation";
      errors.push(detail);
      attemptedSources.push(detail);
      continue;
    }

    if (runtime.provider.getModelCapabilities) {
      try {
        const capabilities =
          await runtime.provider.getModelCapabilities(runtime.model);

        if (capabilities.vision === false) {
          const detail =
            runtime.label + " — model is not vision-capable";
          errors.push(detail);
          attemptedSources.push(detail);
          continue;
        }
      } catch {
        // Capability probing is advisory. The actual vision request remains
        // the final authority when a provider cannot expose metadata.
      }
    }

    const cacheKey = createAiCacheKey(
      "region",
      runtime.cacheModelKey,
      cacheInput,
    );
    const cached = await getCachedAiValue<{
      text: string;
      analysis: RegionAnalysis;
    }>(cacheKey);

    if (cached?.text && cached.analysis) {
      return {
        text: cached.text,
        analysis: cached.analysis,
        model: runtime.model,
        cached: true,
        source: runtime.label,
        fallbackUsed: index > 0,
        attemptedSources: [...attemptedSources, runtime.label],
      };
    }

    attemptedSources.push(runtime.label);

    try {
      const started = Date.now();

      const generated = await runWithAiExecutionPolicy(
        "region",
        async (signal) => {
          const response = await runtime.provider.generateVision!({
            model: runtime.model,
            prompt,
            imageDataUrl,
            signal,
          });

          const analysis = parseStructuredRegionAnalysis(response.text);

          return {
            analysis,
            text: formatStructuredRegionAnalysis(analysis),
            model: response.model || runtime.model,
            usage: response.usage,
          };
        },
      );

      const latencyMs = Date.now() - started;

      await Promise.all([
        recordAiUsage(
          runtime.model,
          "region",
          generated.usage,
          latencyMs,
          runtime.providerConfigId,
          runtime.pricing,
        ),
        putCachedAiValue(
          cacheKey,
          "region",
          runtime.cacheModelKey,
          {
            text: generated.text,
            analysis: generated.analysis,
          },
        ),
      ]);

      return {
        text: generated.text,
        analysis: generated.analysis,
        model: generated.model,
        cached: false,
        source: runtime.label,
        fallbackUsed: index > 0,
        attemptedSources,
      };
    } catch (error) {
      const detail = runtime.label + " — " + errorMessage(error);
      errors.push(detail);
      attemptedSources[attemptedSources.length - 1] = detail;
    }
  }

  throw new Error(
    "All region/image routes failed. " + errors.join(" | "),
  );
}
