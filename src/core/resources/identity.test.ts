import { describe, expect, it } from "vitest";
import {
  normalizeResourceIdentifiers,
  resourceIdentityKeys,
  resourcesShareIdentity,
} from "./identity";

describe("resource identity", () => {
  it("normalizes protocol and publication identifiers", () => {
    expect(
      normalizeResourceIdentifiers({
        sha256: "0xAABB",
        btih: "ABCDEF",
        ed2kHash: "ABC123",
        isbn: "978-1-2345-6789-7",
        doi: "https://doi.org/10.1000/ABC",
      }),
    ).toMatchObject({
      sha256: "aabb",
      btih: "abcdef",
      ed2kHash: "abc123",
      isbn: "9781234567897",
      doi: "10.1000/abc",
    });
  });

  it("builds source-independent identity keys", () => {
    expect(
      resourceIdentityKeys({
        sha256: "AABB",
        btih: "CCDD",
      }),
    ).toEqual(["sha256:aabb", "btih:ccdd"]);
  });

  it("detects the same content through different source records", () => {
    expect(
      resourcesShareIdentity(
        { sha256: "ABCDEF" },
        { sha256: "abcdef", providerVersionId: "remote-v2" },
      ),
    ).toBe(true);
  });
});
