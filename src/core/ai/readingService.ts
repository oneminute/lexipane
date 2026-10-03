import {
  createAiCacheKey,
  getCachedAiValue,
  putCachedAiValue,
} from "./cache";
import { resolveTextTaskRuntime } from "./runtimeRouter";
import type { ReadingTaskType } from "./taskRouting";
import type {
  AIMessage,
  AIUsage,
  TextGenerationRequest,
} from "./types";
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

export type ReadingStreamCallback = (
  accumulatedText: string,
  delta: string,
) => void;

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

interface PreparedReadingRequest {
  taskType: ReadingTaskType;
  input: {
    text: string;
    context: string;
    page: number | null;
    question: string;
    mode: ReadingAnalysisMode;
    promptVersion: number;
  };
  messages: AIMessage[];
}

function prepareReadingRequest(
  selection: ReadingSelection,
  mode: ReadingAnalysisMode,
  question?: string,
): PreparedReadingRequest {
  const taskType = taskTypeForMode(mode);
  const context = trimContext(selection.context);
  const input = {
    text: selection.text.slice(0, 4000),
    context,
    page: selection.page ?? null,
    question: question?.trim() ?? "",
    mode,
    promptVersion: 4,
  };

  const userContent = [
    taskInstruction(mode, question),
    "",
    "Selected text:",
    input.text,
    "",
    context ? "Surrounding reading context:" : "",
    context,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: AIMessage[] = [
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
  ];

  return {
    taskType,
    input,
    messages,
  };
}

async function persistReadingResult(
  taskType: ReadingTaskType,
  cacheKey: string,
  cacheModelKey: string,
  model: string,
  text: string,
  usage: AIUsage | undefined,
  latencyMs: number,
  providerConfigId?: string,
) {
  await Promise.all([
    recordAiUsage(
      model,
      taskType,
      usage,
      latencyMs,
      providerConfigId,
    ),
    putCachedAiValue(
      cacheKey,
      taskType,
      cacheModelKey,
      { text },
    ),
  ]);
}

export async function analyzeReadingSelection(
  selection: ReadingSelection,
  mode: ReadingAnalysisMode,
  question?: string,
): Promise<ReadingAnalysisResult> {
  const prepared = prepareReadingRequest(selection, mode, question);
  const runtime = await resolveTextTaskRuntime(prepared.taskType);

  const cacheKey = createAiCacheKey(
    prepared.taskType,
    runtime.cacheModelKey,
    prepared.input,
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

  const request: TextGenerationRequest = {
    model: runtime.model,
    temperature: 0.2,
    messages: prepared.messages,
  };

  const started = Date.now();
  const response = await runtime.provider.generateText(request);
  const latencyMs = Date.now() - started;
  const text = response.text.trim();

  await persistReadingResult(
    prepared.taskType,
    cacheKey,
    runtime.cacheModelKey,
    runtime.model,
    text,
    response.usage,
    latencyMs,
    runtime.providerConfigId,
  );

  return {
    text,
    model: response.model || runtime.model,
    cached: false,
    source: runtime.label,
  };
}

export async function streamReadingSelection(
  selection: ReadingSelection,
  mode: ReadingAnalysisMode,
  question: string | undefined,
  onStream: ReadingStreamCallback,
): Promise<ReadingAnalysisResult> {
  const prepared = prepareReadingRequest(selection, mode, question);
  const runtime = await resolveTextTaskRuntime(prepared.taskType);

  const cacheKey = createAiCacheKey(
    prepared.taskType,
    runtime.cacheModelKey,
    prepared.input,
  );
  const cached = await getCachedAiValue<{ text: string }>(cacheKey);

  if (cached?.text) {
    onStream(cached.text, cached.text);
    return {
      text: cached.text,
      model: runtime.model,
      cached: true,
      source: runtime.label,
    };
  }

  const request: TextGenerationRequest = {
    model: runtime.model,
    temperature: 0.2,
    messages: prepared.messages,
  };

  if (!runtime.provider.streamText) {
    const result = await analyzeReadingSelection(
      selection,
      mode,
      question,
    );
    onStream(result.text, result.text);
    return result;
  }

  const started = Date.now();
  let text = "";
  let model = runtime.model;
  let usage: AIUsage | undefined;

  for await (const event of runtime.provider.streamText(request)) {
    if (event.model) {
      model = event.model;
    }
    if (event.usage) {
      usage = event.usage;
    }
    if (event.delta) {
      text += event.delta;
      onStream(text, event.delta);
    }
  }

  text = text.trim();
  const latencyMs = Date.now() - started;

  await persistReadingResult(
    prepared.taskType,
    cacheKey,
    runtime.cacheModelKey,
    runtime.model,
    text,
    usage,
    latencyMs,
    runtime.providerConfigId,
  );

  return {
    text,
    model,
    cached: false,
    source: runtime.label,
  };
}
