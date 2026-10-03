export type ReaderNavigationTarget =
  | {
      kind: "pdf-page";
      page: number;
    }
  | {
      kind: "epub-cfi";
      cfi: string;
    }
  | {
      kind: "kindle-chapter";
      chapterId: string;
    };

export function parseReaderNavigationTarget(
  value: string | null | undefined,
): ReaderNavigationTarget | null {
  if (!value) return null;

  try {
    const target = JSON.parse(value) as Partial<ReaderNavigationTarget>;

    if (
      target.kind === "pdf-page" &&
      typeof target.page === "number" &&
      Number.isInteger(target.page) &&
      target.page >= 1
    ) {
      return {
        kind: "pdf-page",
        page: target.page,
      };
    }

    if (
      target.kind === "epub-cfi" &&
      typeof target.cfi === "string" &&
      target.cfi
    ) {
      return {
        kind: "epub-cfi",
        cfi: target.cfi,
      };
    }

    if (
      target.kind === "kindle-chapter" &&
      typeof target.chapterId === "string" &&
      target.chapterId
    ) {
      return {
        kind: "kindle-chapter",
        chapterId: target.chapterId,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function serializeReaderNavigationTarget(
  target: ReaderNavigationTarget | null,
): string | null {
  return target ? JSON.stringify(target) : null;
}
