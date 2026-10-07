export function clampReaderScrollTop(
  savedTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  if (!Number.isFinite(savedTop)) return 0;

  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  return Math.min(maxScrollTop, Math.max(0, savedTop));
}

export function shouldAcceptReaderRelocation(
  active: boolean,
  restoring: boolean,
): boolean {
  return active && !restoring;
}
