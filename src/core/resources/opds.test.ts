import { describe, expect, it } from "vitest";
import { parseOpdsFeed } from "./opds";

describe("OPDS parser", () => {
  it("normalizes OPDS 2 publications and acquisition links", () => {
    const feed = parseOpdsFeed(
      JSON.stringify({
        metadata: { title: "Open Books" },
        links: [
          {
            rel: "search",
            href: "/search{?q}",
            type: "application/opds+json",
          },
        ],
        publications: [
          {
            metadata: {
              identifier: "urn:isbn:123",
              title: "Example Book",
              author: [{ name: "Example Author" }],
              description: "A public catalog item.",
            },
            links: [
              {
                rel: "http://opds-spec.org/acquisition/open-access",
                href: "/books/example.epub",
                type: "application/epub+zip",
              },
            ],
            images: [
              {
                rel: "cover",
                href: "/covers/example.jpg",
                type: "image/jpeg",
              },
            ],
          },
        ],
      }),
      "https://example.test/opds",
      "application/opds+json",
    );

    expect(feed.title).toBe("Open Books");
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]).toMatchObject({
      id: "urn:isbn:123",
      title: "Example Book",
      authors: ["Example Author"],
      coverUrl: "https://example.test/covers/example.jpg",
    });
    expect(feed.entries[0].acquisitions[0]).toMatchObject({
      href: "https://example.test/books/example.epub",
      type: "application/epub+zip",
    });
    expect(feed.searchUrl).toBe(
      "https://example.test/search%7B?q%7D",
    );
  });

  it("does not treat cover links as acquisitions", () => {
    const feed = parseOpdsFeed(
      JSON.stringify({
        metadata: { title: "Catalog" },
        publications: [
          {
            metadata: { title: "Book" },
            links: [
              {
                rel: "cover",
                href: "/cover.pdf",
                type: "image/jpeg",
              },
            ],
          },
        ],
      }),
      "https://example.test/catalog",
      "application/opds+json",
    );

    expect(feed.entries[0].acquisitions).toHaveLength(0);
  });
});
