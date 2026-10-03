import { createAiCacheKey, getCachedAiValue, putCachedAiValue } from "./cache";
import {
  choosePreferredOllamaModel,
  loadOllamaConfig,
  saveOllamaModel,
} from "./ollamaConfig";
import { OllamaProvider } from "./providers/ollama";
import {
  resolveOllamaModelForTask,
  type ReadingTaskType,
} from "./taskRouting";
import { recordAiUsage } from "./usage";

export type ReadingAnalysisMode = "explain" | "grammar" | "ask";

export interface ReadingSelection {
  text: string;
  context?: string;
  page?: number | null;
}

export interface ReadingAnalysisResult {
  text: string;
  model: string;
  cached?: boolean;
}

function trimContext(context: string | undefined): string {
  if (!context) return "";
  const normalized = context.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 7000);
}

function taskInstruction(
  mode: ReadingAnalysisMode,
  question?: string,
): string {
  if (mode === "grammar") {
    return [
      "Analyze the selected English text for a Chinese learner.",
      "Explain the sentence structure, clauses, grammatical constructions,",
      "pronoun/reference relationships, and idiomatic expressions that affect",
      "understanding. End with a natural Chinese interpretation.",
      "Do not spend space on grammar that is obvious or irrelevant.",
    ].join(" ");
  }

  if (mode === "ask") {
    return [
      "Answer the reader's question about the selected text and its context.",
      "Reader question:",
      question?.trim() || "Explain what this means.",
    ].join(" ");
  }

  return [
    "Explain the selected English text in its current context for a Chinese learner.",
    "Start with the natural meaning in this context, then explain important words,",
    "phrases, collocations, idioms, or usage that could block reading.",
    "If it is only a word or phrase, explain why that meaning fits the surrounding text.",
    "Keep the explanation focused instead of giving a dictionary dump.",
  ].join(" ");
}

function taskTypeForMode(mode: ReadingAnalysisMode): ReadingTaskType {
  return mode;
}

export async function analyzeReadingSelection(
  selection: ReadingSelection,
  mode: ReadingAnalysisMode,
  question?: string,
): Promise<ReadingAnalysisResult> {
  const config = await loadOllamaConfig();
  const provider = new OllamaProvider(config.baseUrl);
  const models = await provider.listModels();

  const taskType = taskTypeForMode(mode);
  const model =
    (await resolveOllamaModelForTask(taskType, models, config.model)) ??
    choosePreferredOllamaModel(models, config.model);

  if (!model) {
    throw new Error(
      "Ollama is running, but no local model is installed. Pull a model first.",
    );
  }

  if (!config.model) {
    await saveOllamaModel(model);
  }

  const context = trimContext(selection.context);
  const input = {
    text: selection.text.slice(0, 4000),
    context,
    page: selection.page ?? null,
    question: question?.trim() ?? "",
    mode,
    promptVersion: 2,
  };

  const cacheKey = createAiCacheKey(taskType, model, input);
  const cached = await getCachedAiValue<{ text: string }>(cacheKey);
  if (cached?.text) {
    return {
      text: cached.text,
      model,
      cached: true,
    };
  }

  const userContent = [
    taskInstruction(mode, question),
    "",
    "Selected text:",
    input.text,
    "",
    context ? "Surrounding page context:" : "",
    context,
  ]
    .filter(Boolean)
    .join("\n");

  const started = Date.now();
  const response = await provider.generateText({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are LexiPane, a contextual reading assistant. " +
          "Answer primarily in Simplified Chinese while preserving useful English " +
          "words and structures. Base explanations on the supplied reading context. " +
          "Do not invent missing story facts.",
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  });
  const latencyMs = Date.now() - started;

  const text = response.text.trim();

  await Promise.all([
    recordAiUsage(model, taskType, response.usage, latencyMs),
    putCachedAiValue(cacheKey, taskType, model, { text }),
  ]);

  return {
    text,
    model: response.model,
    cached: false,
  };
}
