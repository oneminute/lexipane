import { describe, expect, it } from "vitest";
import { parseTorrentCatalog } from "./torrentCatalog";

describe("torrent catalog parser", () => {
  it("normalizes JSON catalog results", () => {
    const results = parseTorrentCatalog(
      JSON.stringify({
        results: [
          {
            id: "1",
            title: "Example Book",
            magnet: "magnet:?xt=urn:btih:abc",
            size: 1234,
            seeders: 8,
          },
        ],
      }),
      "https://catalog.example/api",
      "application/json",
    );

    expect(results).toEqual([
      expect.objectContaining({
        id: "1",
        title: "Example Book",
        input: "magnet:?xt=urn:btih:abc",
        size: 1234,
        seeders: 8,
      }),
    ]);
  });

  it("normalizes Torznab/RSS results", () => {
    const xml = `
      <rss xmlns:torznab="http://torznab.com/schemas/2015/feed">
        <channel>
          <item>
            <title>History Book EPUB</title>
            <guid>item-1</guid>
            <torznab:attr name="magneturl" value="magnet:?xt=urn:btih:def" />
            <torznab:attr name="seeders" value="12" />
            <torznab:attr name="size" value="4096" />
          </item>
        </channel>
      </rss>
    `;

    const results = parseTorrentCatalog(
      xml,
      "https://catalog.example/api",
      "application/rss+xml",
    );

    expect(results[0]).toMatchObject({
      title: "History Book EPUB",
      input: "magnet:?xt=urn:btih:def",
      seeders: 12,
      size: 4096,
    });
  });
});
