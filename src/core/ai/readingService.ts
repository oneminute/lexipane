import {
  createAiCacheKey,
  getCachedAiValue,
  putCachedAiValue,
} from "./cache";
import { runWithAiExecutionPolicy } from "./executionPolicy";
import {
  fallbackStructuredReadingAnalysis,
  formatStructuredReadingAnalysis,
  parseStructuredReadingAnalysis,
  structuredOutputInstruction,
  type StructuredReadingAnalysis,
} from "./readingStructured";
import { resolveTextTaskRuntimes } from "./runtimeRouter";
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
  bookPath?: string | null;
}

export interface ReadingRequestDebug {
  taskType: ReadingTaskType;
  mode: ReadingAnalysisMode;
  responseFormat: "json";
  temperature: number;
  thinking: boolean;
  messages: AIMessage[];
}

export interface ReadingAnalysisResult {
  text: string;
  analysis: StructuredReadingAnalysis;
  model: string;
  cached?: boolean;
  source?: string;
  fallbackUsed?: boolean;
  attemptedSources?: string[];
  requestDebug: ReadingRequestDebug;
  rawResponse?: string;
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
      "Analyze exactly the selected English sentence for a Chinese learner.",
      "Start from a natural Chinese translation and the sentence's overall meaning.",
      "Then explain its structure, clauses, grammatical constructions, references,",
      "notable style or information-structure features, and any words or expressions",
      "whose meaning is special in this sentence. Explain contextual meaning rather",
      "than giving a generic dictionary definition. Do not spend space on obvious",
      "grammar that does not help comprehension.",
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
    "Focus on the actual contextual meaning, important expressions, collocations,",
    "idioms, and usage that could block reading. Avoid a dictionary dump.",
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
  debug: ReadingRequestDebug;
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
    promptVersion: 9,
  };

  const userContent = [
    taskInstruction(mode, question),
    structuredOutputInstruction(mode),
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
        "words and structures. Base every claim on the supplied reading context. " +
        "Do not invent missing story facts. Follow the requested JSON schema exactly.",
    },
    {
      role: "user",
      content: userContent,
    },
  ];

  const debug: ReadingRequestDebug = {
    taskType,
    mode,
    responseFormat: "json",
    temperature: 0.15,
    // Structured reading output should be direct. Reasoning-only output from
    // thinking models can otherwise leave message.content empty in Ollama.
    thinking: false,
    messages,
  };

  return {
    taskType,
    input,
    messages,
    debug,
  };
}

export function buildReadingRequestDebug(
  selection: ReadingSelection,
  mode: ReadingAnalysisMode,
  question?: string,
): ReadingRequestDebug {
  return prepareReadingRequest(selection, mode, question).debug;
}

async function persistReadingResult(
  taskType: ReadingTaskType,
  cacheKey: string,
  cacheModelKey: string,
  model: string,
  text: string,
  analysis: StructuredReadingAnalysis,
  usage: AIUsage | undefined,
  latencyMs: number,
  providerConfigId: string | undefined,
  pricing: {
    inputCostPerMillion?: number;
    outputCostPerMillion?: number;
  } | undefined,
) {
  await Promise.all([
    recordAiUsage(
      model,
      taskType,
      usage,
      latencyMs,
      providerConfigId,
      pricing,
    ),
    putCachedAiValue(
      cacheKey,
      taskType,
      cacheModelKey,
      { text, analysis },
    ),
  ]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function executeReadingRequest(
  selection: ReadingSelection,
  mode: ReadingAnalysisMode,
  question: string | undefined,
  stream: boolean,
  onStream?: ReadingStreamCallback,
): Promise<ReadingAnalysisResult> {
  const prepared = prepareReadingRequest(selection, mode, question);
  const runtimes = await resolveTextTaskRuntimes(
    prepared.taskType,
    selection.bookPath,
  );
  const attemptedSources: string[] = [];

  for (let index = 0; index < runtimes.length; index += 1) {
    const runtime = runtimes[index];
    const cacheKey = createAiCacheKey(
      prepared.taskType,
      runtime.cacheModelKey,
      prepared.input,
    );

    const cached = await getCachedAiValue<{
      text: string;
      analysis: StructuredReadingAnalysis;
    }>(cacheKey);

    if (cached?.text && cached.analysis) {
      onStream?.(cached.text, cached.text);
      return {
        text: cached.text,
        analysis: cached.analysis,
        model: runtime.model,
        cached: true,
        source: runtime.label,
        fallbackUsed: index > 0,
        attemptedSources,
        requestDebug: prepared.debug,
      };
    }

    attemptedSources.push(runtime.label);

    try {
      const started = Date.now();

      console.info("[LexiPane AI request]", {
        taskType: prepared.taskType,
        source: runtime.label,
        model: runtime.model,
        responseFormat: prepared.debug.responseFormat,
        temperature: prepared.debug.temperature,
        thinking: prepared.debug.thinking,
        messages: prepared.debug.messages,
      });

      const generated = await runWithAiExecutionPolicy(
        prepared.taskType,
        async (signal) => {
          const request: TextGenerationRequest = {
            model: runtime.model,
            temperature: prepared.debug.temperature,
            responseFormat: prepared.debug.responseFormat,
            thinking: prepared.debug.thinking,
            messages: prepared.messages,
            signal,
          };

          let rawText = "";
          let model = runtime.model;
          let usage: AIUsage | undefined;

          if (stream && runtime.provider.streamText) {
            for await (const event of runtime.provider.streamText(request)) {
              if (event.model) model = event.model;
              if (event.usage) usage = event.usage;
              if (event.delta) rawText += event.delta;
            }
          } else {
            const response = await runtime.provider.generateText(request);
            rawText = response.text;
            model = response.model || runtime.model;
            usage = response.usage;
          }

          console.info("[LexiPane AI response]", {
            taskType: prepared.taskType,
            source: runtime.label,
            model,
            rawText,
            usage,
          });

          if (!rawText.trim()) {
            throw new Error(
              "Model returned an empty content response. " +
                "For Ollama thinking models, LexiPane now sends think=false " +
                "for structured reading requests.",
            );
          }

          let analysis: StructuredReadingAnalysis;

          try {
            analysis = parseStructuredReadingAnalysis(rawText, mode);
          } catch (parseError) {
            analysis = fallbackStructuredReadingAnalysis(
              rawText,
              "Structured parsing failed: " + errorMessage(parseError),
            );
          }

          return {
            analysis,
            text: formatStructuredReadingAnalysis(analysis),
            model,
            usage,
            rawResponse: rawText,
          };
        },
      );

      const latencyMs = Date.now() - started;

      await persistReadingResult(
        prepared.taskType,
        cacheKey,
        runtime.cacheModelKey,
        runtime.model,
        generated.text,
        generated.analysis,
        generated.usage,
        latencyMs,
        runtime.providerConfigId,
        runtime.pricing,
      );

      onStream?.(generated.text, generated.text);

      return {
        text: generated.text,
        analysis: generated.analysis,
        model: generated.model,
        cached: false,
        source: runtime.label,
        fallbackUsed: index > 0,
        attemptedSources,
        requestDebug: prepared.debug,
        rawResponse: generated.rawResponse,
      };
    } catch (error) {
      attemptedSources[attemptedSources.length - 1] =
        runtime.label + " — " + errorMessage(error);
    }
  }

  throw new Error(
    "All configured AI routes failed. " +
      attemptedSources.join(" | "),
  );
}

export async function analyzeReadingSelection(
  selection: ReadingSelection,
  mode: ReadingAnalysisMode,
  question?: string,
): Promise<ReadingAnalysisResult> {
  return executeReadingRequest(
    selection,
    mode,
    question,
    false,
  );
}

export async function streamReadingSelection(
  selection: ReadingSelection,
  mode: ReadingAnalysisMode,
  question: string | undefined,
  onStream: ReadingStreamCallback,
): Promise<ReadingAnalysisResult> {
  return executeReadingRequest(
    selection,
    mode,
    question,
    true,
    onStream,
  );
}
