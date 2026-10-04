import { fetchHttpText } from "./httpTransport";

export interface OpdsLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}

export interface OpdsEntry {
  id: string;
  title: string;
  authors: string[];
  summary?: string;
  coverUrl?: string;
  links: OpdsLink[];
  acquisitions: OpdsLink[];
  navigation: OpdsLink[];
}

export interface OpdsFeed {
  title: string;
  url: string;
  entries: OpdsEntry[];
  links: OpdsLink[];
  searchUrl?: string;
  searchType?: string;
}

const ACQUISITION_REL = "http://opds-spec.org/acquisition";
const BOOK_MEDIA_TYPES = new Set([
  "application/epub+zip",
  "application/pdf",
]);

function resolveUrl(href: string, baseUrl: string): string {
  const leftBrace = "__LEXIPANE_LEFT_BRACE__";
  const rightBrace = "__LEXIPANE_RIGHT_BRACE__";
  const protectedHref = href
    .replaceAll("{", leftBrace)
    .replaceAll("}", rightBrace);

  try {
    return new URL(protectedHref, baseUrl)
      .toString()
      .replaceAll(leftBrace, "{")
      .replaceAll(rightBrace, "}");
  } catch {
    return href;
  }
}

function supportedAcquisition(link: OpdsLink): boolean {
  return (
    link.rel.includes(ACQUISITION_REL) ||
    Boolean(link.type && BOOK_MEDIA_TYPES.has(link.type.toLowerCase()))
  );
}

function supportedNavigation(link: OpdsLink): boolean {
  if (supportedAcquisition(link)) return false;

  const type = link.type?.toLowerCase() ?? "";
  const rel = link.rel.toLowerCase();

  return (
    type.includes("application/atom+xml") ||
    type.includes("application/opds+json") ||
    rel.includes("subsection") ||
    rel.includes("collection") ||
    rel.split(/\s+/).includes("navigation")
  );
}

function directChild(
  element: Element,
  localName: string,
): Element | null {
  return (
    Array.from(element.children).find(
      (child) => child.localName.toLowerCase() === localName,
    ) ?? null
  );
}

function directChildren(
  element: Element,
  localName: string,
): Element[] {
  return Array.from(element.children).filter(
    (child) => child.localName.toLowerCase() === localName,
  );
}

function childText(
  element: Element,
  localName: string,
): string {
  return directChild(element, localName)?.textContent?.trim() ?? "";
}

function xmlLinks(
  element: Element,
  baseUrl: string,
): OpdsLink[] {
  return directChildren(element, "link").flatMap((link) => {
    const href = link.getAttribute("href")?.trim();
    if (!href) return [];

    return [{
      rel: link.getAttribute("rel")?.trim() ?? "",
      href: resolveUrl(href, baseUrl),
      type: link.getAttribute("type")?.trim() || undefined,
      title: link.getAttribute("title")?.trim() || undefined,
    }];
  });
}

function parseAtomFeed(
  body: string,
  baseUrl: string,
): OpdsFeed {
  const document = new DOMParser().parseFromString(
    body,
    "application/xml",
  );
  const parserError = document.querySelector("parsererror");

  if (parserError) {
    throw new Error("The OPDS catalog returned invalid XML.");
  }

  const feed = document.documentElement;
  const links = xmlLinks(feed, baseUrl);
  const entries = directChildren(feed, "entry").map((entry) => {
    const entryLinks = xmlLinks(entry, baseUrl);
    const authors = directChildren(entry, "author")
      .map((author) => childText(author, "name"))
      .filter(Boolean);
    const cover = entryLinks.find((link) =>
      link.rel.includes("image") || link.rel.includes("cover"),
    );

    return {
      id:
        childText(entry, "id") ||
        entryLinks[0]?.href ||
        crypto.randomUUID(),
      title: childText(entry, "title") || "Untitled resource",
      authors,
      summary:
        childText(entry, "summary") ||
        childText(entry, "content") ||
        undefined,
      coverUrl: cover?.href,
      links: entryLinks,
      acquisitions: entryLinks.filter(supportedAcquisition),
      navigation: entryLinks.filter(supportedNavigation),
    };
  });

  const search = links.find((link) =>
    link.rel.split(/\s+/).includes("search"),
  );

  return {
    title: childText(feed, "title") || "OPDS catalog",
    url: baseUrl,
    entries,
    links,
    searchUrl: search?.href,
    searchType: search?.type,
  };
}

function jsonLinks(
  value: unknown,
  baseUrl: string,
): OpdsLink[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const href =
      typeof record.href === "string" ? record.href.trim() : "";
    if (!href) return [];

    const rel = Array.isArray(record.rel)
      ? record.rel
          .filter((part): part is string => typeof part === "string")
          .join(" ")
      : typeof record.rel === "string"
        ? record.rel
        : "";

    return [{
      rel,
      href: resolveUrl(href, baseUrl),
      type: typeof record.type === "string" ? record.type : undefined,
      title: typeof record.title === "string" ? record.title : undefined,
    }];
  });
}

function parseOpds2Feed(
  body: string,
  baseUrl: string,
): OpdsFeed {
  const root = JSON.parse(body) as Record<string, unknown>;
  const metadata =
    root.metadata && typeof root.metadata === "object"
      ? root.metadata as Record<string, unknown>
      : {};
  const publications = Array.isArray(root.publications)
    ? root.publications
    : [];
  const navigation = Array.isArray(root.navigation)
    ? root.navigation
    : [];
  const links = jsonLinks(root.links, baseUrl);

  const entries = [...publications, ...navigation].flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const itemMetadata =
      record.metadata && typeof record.metadata === "object"
        ? record.metadata as Record<string, unknown>
        : {};
    const entryLinks = jsonLinks(record.links, baseUrl);
    const authorValue = itemMetadata.author;

    const authors = Array.isArray(authorValue)
      ? authorValue.flatMap((author) => {
          if (typeof author === "string") return [author];
          if (
            author &&
            typeof author === "object" &&
            typeof (author as Record<string, unknown>).name === "string"
          ) {
            return [
              (author as Record<string, unknown>).name as string,
            ];
          }
          return [];
        })
      : typeof authorValue === "string"
        ? [authorValue]
        : [];

    const images = jsonLinks(record.images, baseUrl);

    return [{
      id:
        typeof itemMetadata.identifier === "string"
          ? itemMetadata.identifier
          : entryLinks[0]?.href ?? crypto.randomUUID(),
      title:
        typeof itemMetadata.title === "string"
          ? itemMetadata.title
          : "Untitled resource",
      authors,
      summary:
        typeof itemMetadata.description === "string"
          ? itemMetadata.description
          : undefined,
      coverUrl: images[0]?.href,
      links: [...entryLinks, ...images],
      acquisitions: entryLinks.filter(supportedAcquisition),
      navigation: entryLinks.filter(supportedNavigation),
    }];
  });

  const search = links.find((link) =>
    link.rel.split(/\s+/).includes("search"),
  );

  return {
    title:
      typeof metadata.title === "string"
        ? metadata.title
        : "OPDS catalog",
    url: baseUrl,
    entries,
    links,
    searchUrl: search?.href,
    searchType: search?.type,
  };
}

export function parseOpdsFeed(
  body: string,
  baseUrl: string,
  contentType?: string,
): OpdsFeed {
  const trimmed = body.trim();
  const isJson =
    contentType?.toLowerCase().includes("json") ||
    trimmed.startsWith("{");

  return isJson
    ? parseOpds2Feed(trimmed, baseUrl)
    : parseAtomFeed(trimmed, baseUrl);
}

export async function fetchOpdsCatalog(
  url: string,
): Promise<OpdsFeed> {
  const response = await fetchHttpText(url);
  return parseOpdsFeed(
    response.body,
    response.finalUrl,
    response.contentType,
  );
}

function applySearchTemplate(
  template: string,
  query: string,
): string | null {
  if (!template.includes("{searchTerms")) return null;

  return template
    .replace(
      /\{searchTerms\??\}/g,
      encodeURIComponent(query.trim()),
    )
    .replace(/\{[^}]+\??\}/g, "");
}

function searchUrlFallback(
  catalogUrl: string,
  query: string,
): string {
  const url = new URL(catalogUrl);
  url.searchParams.set("q", query.trim());
  return url.toString();
}

async function openSearchTemplate(
  descriptionUrl: string,
  query: string,
): Promise<string | null> {
  const response = await fetchHttpText(descriptionUrl);
  const document = new DOMParser().parseFromString(
    response.body,
    "application/xml",
  );

  const candidates = Array.from(
    document.getElementsByTagNameNS("*", "Url"),
  );

  for (const candidate of candidates) {
    const template = candidate.getAttribute("template");
    const type = candidate.getAttribute("type") ?? "";

    if (
      template &&
      (type.includes("atom") ||
        type.includes("opds") ||
        type.includes("json"))
    ) {
      const resolved = resolveUrl(template, response.finalUrl);
      const applied = applySearchTemplate(resolved, query);
      if (applied) return applied;
    }
  }

  return null;
}

export async function searchOpdsCatalog(
  catalogUrl: string,
  query: string,
): Promise<OpdsFeed> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return fetchOpdsCatalog(catalogUrl);

  const root = await fetchOpdsCatalog(catalogUrl);
  let searchUrl: string | null = null;

  if (root.searchUrl) {
    searchUrl = applySearchTemplate(root.searchUrl, normalizedQuery);

    if (
      !searchUrl &&
      root.searchType?.toLowerCase().includes("opensearch")
    ) {
      searchUrl = await openSearchTemplate(
        root.searchUrl,
        normalizedQuery,
      );
    }
  }

  return fetchOpdsCatalog(
    searchUrl ?? searchUrlFallback(catalogUrl, normalizedQuery),
  );
}
