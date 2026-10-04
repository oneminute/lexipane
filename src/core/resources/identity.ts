import type { ResourceIdentifiers } from "./types";

function normalizeHex(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/^0x/, "");
  return normalized || undefined;
}

export function normalizeResourceIdentifiers(
  identifiers: ResourceIdentifiers,
): ResourceIdentifiers {
  return {
    ...identifiers,
    isbn: identifiers.isbn?.replace(/[-\s]/g, "").toUpperCase(),
    doi: identifiers.doi?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, ""),
    sha256: normalizeHex(identifiers.sha256),
    btih: normalizeHex(identifiers.btih),
    btmh: identifiers.btmh?.trim().toLowerCase(),
    ed2kHash: normalizeHex(identifiers.ed2kHash),
    providerVersionId: identifiers.providerVersionId?.trim() || undefined,
  };
}

export function resourceIdentityKeys(
  identifiers: ResourceIdentifiers,
): string[] {
  const normalized = normalizeResourceIdentifiers(identifiers);
  const keys: string[] = [];

  if (normalized.sha256) keys.push("sha256:" + normalized.sha256);
  if (normalized.btih) keys.push("btih:" + normalized.btih);
  if (normalized.btmh) keys.push("btmh:" + normalized.btmh);
  if (normalized.ed2kHash) keys.push("ed2k:" + normalized.ed2kHash);
  if (normalized.isbn) keys.push("isbn:" + normalized.isbn);
  if (normalized.doi) keys.push("doi:" + normalized.doi);

  return keys;
}

export function resourcesShareIdentity(
  left: ResourceIdentifiers,
  right: ResourceIdentifiers,
): boolean {
  const rightKeys = new Set(resourceIdentityKeys(right));
  return resourceIdentityKeys(left).some((key) => rightKeys.has(key));
}
