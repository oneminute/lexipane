function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function balancedObjectCandidate(value: string): string | null {
  const start = value.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

function repairJsonCandidate(value: string): string {
  let repaired = value
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([}\]])/g, "$1");

  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < repaired.length; index += 1) {
    const char = repaired[index];

    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        result += char;
        escaped = true;
        continue;
      }

      if (char === '"') {
        result += char;
        inString = false;
        continue;
      }

      if (char === "\n") {
        result += "\\n";
        continue;
      }

      if (char === "\r") {
        result += "\\r";
        continue;
      }

      if (char === "\t") {
        result += "\\t";
        continue;
      }

      result += char;
      continue;
    }

    if (char === '"') {
      inString = true;
    }

    result += char;
  }

  return result;
}

function parseJsonCandidate(candidate: string): unknown {
  const variants = [
    candidate,
    repairJsonCandidate(candidate),
  ];

  for (const variant of variants) {
    try {
      const parsed = JSON.parse(variant);

      if (typeof parsed === "string") {
        try {
          return JSON.parse(parsed);
        } catch {
          // A JSON string is not a structured object; continue below.
        }
      }

      return parsed;
    } catch {
      // Try the next repair variant.
    }
  }

  throw new Error("The model did not return valid JSON.");
}

export function extractJsonObject(text: string): unknown {
  const candidate = stripCodeFence(text);

  try {
    return parseJsonCandidate(candidate);
  } catch {
    const balanced = balancedObjectCandidate(candidate);

    if (balanced) {
      return parseJsonCandidate(balanced);
    }

    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return parseJsonCandidate(candidate.slice(start, end + 1));
    }

    throw new Error("The model did not return valid JSON.");
  }
}
