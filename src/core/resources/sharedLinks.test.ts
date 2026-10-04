import { describe, expect, it } from "vitest";
import { cloudShareDownloadUrl } from "./sharedLinks";

describe("cloud share link resolver", () => {
  it("resolves Google Drive file links", () => {
    const url = cloudShareDownloadUrl(
      "google-drive",
      "https://drive.google.com/file/d/abc123/view?usp=sharing",
    );

    expect(url).toContain("drive.usercontent.google.com/download");
    expect(url).toContain("id=abc123");
  });

  it("forces Dropbox downloads", () => {
    const url = cloudShareDownloadUrl(
      "dropbox",
      "https://www.dropbox.com/scl/fi/abc/book.epub?rlkey=x&dl=0",
    );

    expect(new URL(url).searchParams.get("dl")).toBe("1");
  });

  it("requests OneDrive download mode", () => {
    const url = cloudShareDownloadUrl(
      "onedrive",
      "https://1drv.ms/u/s!example",
    );

    expect(new URL(url).searchParams.get("download")).toBe("1");
  });
});
