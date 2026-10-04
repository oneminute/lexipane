import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export function describeRequestError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;

    for (const key of ["message", "error", "details"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Fall through to the generic message below.
    }
  }

  return "HTTP request failed.";
}

export async function appFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    if (isTauri()) {
      return await tauriFetch(input, init);
    }

    return await globalThis.fetch(input, init);
  } catch (error) {
    throw new Error(describeRequestError(error));
  }
}
