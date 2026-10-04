export const APP_DEFAULTS = {
  ai: {
    ollama: {
      baseUrl: "http://127.0.0.1:12000",
      discoveryBaseUrls: [
        "http://127.0.0.1:12000",
        "http://127.0.0.1:11434",
      ],
      preferredModelNameHints: ["qwen3.5", "qwen"],
    },
    privacyMode: "prefer-local",
    healthCheck: {
      timeoutMs: 120_000,
    },
    execution: {
      explain: {
        timeoutMs: 60_000,
        retries: 1,
        retryDelayMs: 700,
      },
      grammar: {
        timeoutMs: 75_000,
        retries: 1,
        retryDelayMs: 700,
      },
      ask: {
        timeoutMs: 75_000,
        retries: 1,
        retryDelayMs: 700,
      },
      difficulty: {
        timeoutMs: 30_000,
        retries: 0,
        retryDelayMs: 500,
      },
      region: {
        timeoutMs: 90_000,
        retries: 0,
        retryDelayMs: 800,
      },
    },
  },
  reading: {
    level: "B2",
    ebook: {
      fontScale: 100,
      theme: "light",
      epubFlow: "scrolled",
    },
  },
  ocr: {
    language: "eng",
  },
} as const;
