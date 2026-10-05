import { describe, expect, it } from "vitest";
import { parseArxivFeed } from "./arxiv";

describe("arXiv feed parser", () => {
  it("normalizes paper metadata and PDF links", () => {
    const results = parseArxivFeed(`
      <?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2601.01234v2</id>
          <updated>2026-01-05T12:00:00Z</updated>
          <published>2026-01-03T12:00:00Z</published>
          <title>  A Useful Paper  </title>
          <summary> A concise summary. </summary>
          <author><name>Alice Example</name></author>
          <author><name>Bob Example</name></author>
          <category term="cs.AI"/>
          <category term="cs.LG"/>
          <link title="pdf" href="http://arxiv.org/pdf/2601.01234v2" type="application/pdf"/>
        </entry>
      </feed>
    `);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "2601.01234v2",
      title: "A Useful Paper",
      authors: ["Alice Example", "Bob Example"],
      summary: "A concise summary.",
      pdfUrl: "https://arxiv.org/pdf/2601.01234v2",
      categories: ["cs.AI", "cs.LG"],
    });
  });

  it("falls back to the canonical PDF URL", () => {
    const results = parseArxivFeed(`
      <feed>
        <entry>
          <id>https://arxiv.org/abs/2501.00001</id>
          <title>Fallback PDF</title>
        </entry>
      </feed>
    `);

    expect(results[0]?.pdfUrl).toBe(
      "https://arxiv.org/pdf/2501.00001",
    );
  });
});
