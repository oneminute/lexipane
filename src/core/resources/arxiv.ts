import { fetchHttpText } from "./httpTransport";

export interface ArxivResult {
  id: string;
  title: string;
  authors: string[];
  summary?: string;
  pdfUrl: string;
  publishedAt?: string;
  updatedAt?: string;
  categories: string[];
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagText(body: string, tag: string): string | undefined {
  const match = body.match(
    new RegExp(
      "<(?:[\\w.-]+:)?" +
        tag +
        "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" +
        tag +
        ">",
      "i",
    ),
  );
  const value = match?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value ? decodeXml(value) : undefined;
}

function attribute(source: string, name: string): string | undefined {
  const match = source.match(
    new RegExp(
      "(?:^|\\s)" +
        name +
        "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')",
      "i",
    ),
  );
  const value = match?.[1] ?? match?.[2];
  return value ? decodeXml(value.trim()) : undefined;
}

export function parseArxivFeed(xml: string): ArxivResult[] {
  const entries = Array.from(
    xml.matchAll(
      /<(?:[\w.-]+:)?entry(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?entry>/gi,
    ),
  );

  return entries.flatMap((match) => {
    const body = match[1] ?? "";
    const rawId = tagText(body, "id");
    const title = tagText(body, "title");

    if (!rawId || !title) return [];

    const id = rawId
      .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
      .trim();

    const authors = Array.from(
      body.matchAll(
        /<(?:[\w.-]+:)?author(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?author>/gi,
      ),
    )
      .map((author) => tagText(author[1] ?? "", "name"))
      .filter((name): name is string => Boolean(name));

    let pdfUrl: string | undefined;
    for (const linkMatch of body.matchAll(
      /<(?:[\w.-]+:)?link\b([^>]*)\/?\s*>/gi,
    )) {
      const attrs = linkMatch[1] ?? "";
      const href = attribute(attrs, "href");
      const type = attribute(attrs, "type")?.toLowerCase();
      const titleAttr = attribute(attrs, "title")?.toLowerCase();

      if (
        href &&
        (type === "application/pdf" || titleAttr === "pdf")
      ) {
        pdfUrl = href.replace(/^http:\/\//i, "https://");
        break;
      }
    }

    if (!pdfUrl) {
      pdfUrl = "https://arxiv.org/pdf/" + encodeURIComponent(id);
    }

    const categories = Array.from(
      body.matchAll(
        /<(?:[\w.-]+:)?category\b([^>]*)\/?\s*>/gi,
      ),
    )
      .map((item) => attribute(item[1] ?? "", "term"))
      .filter((value): value is string => Boolean(value));

    return [{
      id,
      title,
      authors,
      summary: tagText(body, "summary"),
      pdfUrl,
      publishedAt: tagText(body, "published"),
      updatedAt: tagText(body, "updated"),
      categories,
    }];
  });
}

export async function searchArxiv(
  query: string,
  maxResults = 25,
): Promise<ArxivResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const params = new URLSearchParams();
  params.set("search_query", "all:" + normalized);
  params.set("start", "0");
  params.set(
    "max_results",
    String(Math.max(1, Math.min(50, maxResults))),
  );
  params.set("sortBy", "relevance");
  params.set("sortOrder", "descending");

  const response = await fetchHttpText(
    "https://export.arxiv.org/api/query?" + params.toString(),
  );

  return parseArxivFeed(response.body);
}
