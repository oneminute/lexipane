import { describe, expect, it } from "vitest";

function decodeForTest(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const binary = atob(dataUrl.slice(comma + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

describe("OCR image data handling", () => {
  it("keeps base64 PNG bytes intact", () => {
    const bytes = decodeForTest("data:image/png;base64,AQIDBA==");
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });
});
