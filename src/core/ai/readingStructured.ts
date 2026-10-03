import { extractJsonObject } from "./structured";
import type { ReadingAnalysisMode } from "./readingService";

export interface ReadingExpression {
  text: string;
  meaning: string;
  note?: string;
}

export interface ReadingStructurePart {
  part: string;
  role: string;
  explanation: string;
}

export interface ReadingGrammarPoint {
  name: string;
  explanation: string;
}

export interface ExplanationAnalysis {
  kind: "explanation";
  meaningInContext: string;
  naturalChinese: string;
  partOfSpeech?: string;
  difficulty?: string;
  keyExpressions: ReadingExpression[];
  usageNotes: string[];
}

export interface GrammarAnalysis {
  kind: "grammar";
  naturalChinese: string;
  meaning: string;
  structure: ReadingStructurePart[];
  grammarPoints: ReadingGrammarPoint[];
  difficultExpressions: ReadingExpression[];
}

export interface AnswerAnalysis {
  kind: "answer";
  answer: string;
  keyPoints: string[];
  evidence: string[];
}

export type StructuredReadingAnalysis =
  | ExplanationAnalysis
  | GrammarAnalysis
  | AnswerAnalysis;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(text)
    .filter(Boolean)
    .slice(0, limit);
}

function expressions(value: unknown): ReadingExpression[] {
  if (!Array.isArray(value)) return [];

  const result: ReadingExpression[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const expressionText = text(record.text);
    const meaning = text(record.meaning);

    if (!expressionText || !meaning) continue;

    const note = text(record.note);
    result.push({
      text: expressionText,
      meaning,
      ...(note ? { note } : {}),
    });

    if (result.length >= 12) break;
  }

  return result;
}

function structureParts(value: unknown): ReadingStructurePart[] {
  if (!Array.isArray(value)) return [];

  const result: ReadingStructurePart[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const part = text(record.part);
    const role = text(record.role);
    const explanation = text(record.explanation);

    if (!part || !explanation) continue;

    result.push({
      part,
      role: role || "structure",
      explanation,
    });

    if (result.length >= 16) break;
  }

  return result;
}

function grammarPoints(value: unknown): ReadingGrammarPoint[] {
  if (!Array.isArray(value)) return [];

  const result: ReadingGrammarPoint[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = text(record.name);
    const explanation = text(record.explanation);

    if (!name || !explanation) continue;

    result.push({ name, explanation });
    if (result.length >= 12) break;
  }

  return result;
}

export function structuredOutputInstruction(
  mode: ReadingAnalysisMode,
): string {
  if (mode === "grammar") {
    return [
      "Return ONLY valid JSON. Do not wrap it in Markdown.",
      "Use this exact object shape:",
      '{"kind":"grammar","naturalChinese":"自然中文翻译","meaning":"句子整体含义","structure":[{"part":"原文片段","role":"主句/从句/短语等","explanation":"这部分在句子中的作用"}],"grammarPoints":[{"name":"语法点","explanation":"结合原句解释"}],"difficultExpressions":[{"text":"原文表达","meaning":"中文含义","note":"为什么这样理解"}]}',
      "Keep arrays selective. Do not invent grammar points that do not help comprehension.",
    ].join(" ");
  }

  if (mode === "ask") {
    return [
      "Return ONLY valid JSON. Do not wrap it in Markdown.",
      "Use this exact object shape:",
      '{"kind":"answer","answer":"直接回答读者问题","keyPoints":["关键点"],"evidence":["支持答案的原文片段或上下文依据"]}',
      "Evidence must come from the supplied selection/context. If evidence is unavailable, leave the array empty.",
    ].join(" ");
  }

  return [
    "Return ONLY valid JSON. Do not wrap it in Markdown.",
    "Use this exact object shape:",
    '{"kind":"explanation","meaningInContext":"当前语境中的核心含义","naturalChinese":"自然中文解释或翻译","partOfSpeech":"可选词性/表达类型","difficulty":"可选 CEFR 或难度","keyExpressions":[{"text":"原文词或短语","meaning":"当前语境含义","note":"用法或为什么这样理解"}],"usageNotes":["有助于阅读理解的用法提示"]}',
    "Avoid dictionary dumps. Focus on the selected text in the supplied context.",
  ].join(" ");
}

export function parseStructuredReadingAnalysis(
  rawText: string,
  mode: ReadingAnalysisMode,
): StructuredReadingAnalysis {
  const parsed = extractJsonObject(rawText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI returned a non-object structured response.");
  }

  const record = parsed as Record<string, unknown>;

  if (mode === "explain") {
    const meaningInContext = text(record.meaningInContext);
    const naturalChinese = text(record.naturalChinese);

    if (!meaningInContext || !naturalChinese) {
      throw new Error(
        "Structured explanation is missing meaningInContext or naturalChinese.",
      );
    }

    const partOfSpeech = text(record.partOfSpeech);
    const difficulty = text(record.difficulty);

    return {
      kind: "explanation",
      meaningInContext,
      naturalChinese,
      ...(partOfSpeech ? { partOfSpeech } : {}),
      ...(difficulty ? { difficulty } : {}),
      keyExpressions: expressions(record.keyExpressions),
      usageNotes: stringArray(record.usageNotes),
    };
  }

  if (mode === "grammar") {
    const naturalChinese = text(record.naturalChinese);
    const meaning = text(record.meaning);

    if (!naturalChinese || !meaning) {
      throw new Error(
        "Structured grammar analysis is missing naturalChinese or meaning.",
      );
    }

    return {
      kind: "grammar",
      naturalChinese,
      meaning,
      structure: structureParts(record.structure),
      grammarPoints: grammarPoints(record.grammarPoints),
      difficultExpressions: expressions(record.difficultExpressions),
    };
  }

  const answer = text(record.answer);
  if (!answer) {
    throw new Error("Structured answer is missing answer.");
  }

  return {
    kind: "answer",
    answer,
    keyPoints: stringArray(record.keyPoints),
    evidence: stringArray(record.evidence),
  };
}

export function formatStructuredReadingAnalysis(
  analysis: StructuredReadingAnalysis,
): string {
  if (analysis.kind === "explanation") {
    const lines = [
      "Meaning in context: " + analysis.meaningInContext,
      "中文: " + analysis.naturalChinese,
    ];

    if (analysis.partOfSpeech) {
      lines.push("Type: " + analysis.partOfSpeech);
    }
    if (analysis.difficulty) {
      lines.push("Difficulty: " + analysis.difficulty);
    }

    if (analysis.keyExpressions.length > 0) {
      lines.push(
        "",
        "Key expressions:",
        ...analysis.keyExpressions.map(
          (item) =>
            "- " +
            item.text +
            ": " +
            item.meaning +
            (item.note ? " — " + item.note : ""),
        ),
      );
    }

    if (analysis.usageNotes.length > 0) {
      lines.push("", "Usage notes:", ...analysis.usageNotes.map((item) => "- " + item));
    }

    return lines.join("\n");
  }

  if (analysis.kind === "grammar") {
    const lines = [
      "中文: " + analysis.naturalChinese,
      "Meaning: " + analysis.meaning,
    ];

    if (analysis.structure.length > 0) {
      lines.push(
        "",
        "Structure:",
        ...analysis.structure.map(
          (item) =>
            "- [" + item.role + "] " + item.part + ": " + item.explanation,
        ),
      );
    }

    if (analysis.grammarPoints.length > 0) {
      lines.push(
        "",
        "Grammar:",
        ...analysis.grammarPoints.map(
          (item) => "- " + item.name + ": " + item.explanation,
        ),
      );
    }

    if (analysis.difficultExpressions.length > 0) {
      lines.push(
        "",
        "Expressions:",
        ...analysis.difficultExpressions.map(
          (item) =>
            "- " +
            item.text +
            ": " +
            item.meaning +
            (item.note ? " — " + item.note : ""),
        ),
      );
    }

    return lines.join("\n");
  }

  return [
    analysis.answer,
    ...(analysis.keyPoints.length > 0
      ? ["", "Key points:", ...analysis.keyPoints.map((item) => "- " + item)]
      : []),
    ...(analysis.evidence.length > 0
      ? ["", "Evidence:", ...analysis.evidence.map((item) => "- " + item)]
      : []),
  ].join("\n");
}
