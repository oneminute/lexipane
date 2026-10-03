import {
  createAiCacheKey,
  getCachedAiValue,
  putCachedAiValue,
} from "./cache";
import { resolveTextTaskRuntime } from "./runtimeRouter";
import type { ReadingTaskType } from "./taskRouting";
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
  source?: string;
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
  const taskType = taskTypeForMode(mode);
  const runtime = await resolveTextTaskRuntime(taskType);

  const context = trimContext(selection.context);
  const input = {
    text: selection.text.slice(0, 4000),
    context,
    page: selection.page ?? null,
    question: question?.trim() ?? "",
    mode,
    promptVersion: 3,
  };

  const cacheKey = createAiCacheKey(
    taskType,
    runtime.cacheModelKey,
    input,
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
  const response = await runtime.provider.generateText({
    model: runtime.model,
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
    recordAiUsage(
      runtime.model,
      taskType,
      response.usage,
      latencyMs,
      runtime.providerConfigId,
    ),
    putCachedAiValue(
      cacheKey,
      taskType,
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
