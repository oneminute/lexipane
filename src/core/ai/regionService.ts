import {
  createAiCacheKey,
  getCachedAiValue,
  putCachedAiValue,
  stableHash,
} from "./cache";
import {
  choosePreferredOllamaModel,
  loadOllamaConfig,
  saveOllamaModel,
} from "./ollamaConfig";
import { OllamaProvider } from "./providers/ollama";
import { resolveOllamaModelForTask } from "./taskRouting";
import { recordAiUsage } from "./usage";

export interface RegionAnalysisResult {
  text: string;
  model: string;
  cached: boolean;
}

export async function analyzeRegionImage(
  imageDataUrl: string,
  pageContext: string,
  question?: string,
): Promise<RegionAnalysisResult> {
  const config = await loadOllamaConfig();
  const provider = new OllamaProvider(config.baseUrl);
  const models = await provider.listModels();

  const model =
    (await resolveOllamaModelForTask("region", models, config.model)) ??
    choosePreferredOllamaModel(models, config.model);

  if (!model) {
    throw new Error("No local Ollama model is installed.");
  }

  if (!config.model) {
    await saveOllamaModel(model);
  }

  const capabilities = await provider.getCapabilities(model);
  if (!capabilities.includes("vision")) {
    throw new Error(
      'The routed model "' +
        model +
        '" does not report Ollama vision capability. Choose a vision-capable local model for Region / image in AI & Models.',
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
    promptVersion: 1,
  };
  const cacheKey = createAiCacheKey("region", model, cacheInput);
  const cached = await getCachedAiValue<{ text: string }>(cacheKey);
  if (cached?.text) {
    return {
      text: cached.text,
      model,
      cached: true,
    };
  }

  const prompt = [
    "You are LexiPane, a contextual reading assistant.",
    "Analyze the selected image region from an English book or PDF.",
    "Answer primarily in Simplified Chinese while preserving useful English terms.",
    "If it contains text, explain the text in context. If it contains a chart, diagram, formula, table, or illustration, explain what the reader needs to understand.",
    "Do not invent details that are not visible.",
    question?.trim() ? "Reader question: " + question.trim() : "",
    trimmedContext ? "Nearby page text: " + trimmedContext : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const started = Date.now();
  const response = await provider.generateVisionText(
    model,
    prompt,
    imageDataUrl,
  );
  const latencyMs = Date.now() - started;
  const text = response.text.trim();

  await Promise.all([
    recordAiUsage(model, "region", response.usage, latencyMs),
    putCachedAiValue(cacheKey, "region", model, { text }),
  ]);

  return {
    text,
    model: response.model,
    cached: false,
  };
}
