export interface SentenceSegment {
  text: string;
  start: number;
  end: number;
}

export interface DomSentenceSelection {
  text: string;
  context: string;
  index: number;
  count: number;
  range: Range;
}

interface TextPoint {
  node: Text;
  offset: number;
}

interface DomTextModel {
  text: string;
  points: TextPoint[];
}

const BLOCK_ELEMENTS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "DT",
  "DD",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

function nearestBlock(node: Node | null): Element | null {
  let element =
    node?.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node?.parentElement ?? null;

  while (element) {
    if (BLOCK_ELEMENTS.has(element.tagName)) return element;
    element = element.parentElement;
  }

  return null;
}

function appendSpace(
  text: string[],
  points: TextPoint[],
  point: TextPoint,
) {
  if (text.length === 0 || text[text.length - 1] === " ") return;
  text.push(" ");
  points.push(point);
}

function buildDomTextModel(root: Node): DomTextModel {
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const text: string[] = [];
  const points: TextPoint[] = [];

  let previousBlock: Element | null = null;
  let node = walker.nextNode();

  while (node) {
    const textNode = node as Text;
    const parent = textNode.parentElement;

    if (
      parent &&
      !parent.closest("script, style, noscript") &&
      textNode.data
    ) {
      const block = nearestBlock(textNode);

      if (
        previousBlock &&
        block &&
        previousBlock !== block &&
        text.length > 0
      ) {
        appendSpace(text, points, {
          node: textNode,
          offset: 0,
        });
      }

      let pendingWhitespace = false;

      for (let offset = 0; offset < textNode.data.length; offset += 1) {
        const char = textNode.data[offset];

        if (/\s|\u00a0/.test(char)) {
          pendingWhitespace = true;
          continue;
        }

        if (pendingWhitespace) {
          appendSpace(text, points, {
            node: textNode,
            offset,
          });
          pendingWhitespace = false;
        }

        text.push(char);
        points.push({
          node: textNode,
          offset,
        });
      }

      previousBlock = block ?? previousBlock;
    }

    node = walker.nextNode();
  }

  while (text[text.length - 1] === " ") {
    text.pop();
    points.pop();
  }

  return {
    text: text.join(""),
    points,
  };
}

function trimSegment(
  text: string,
  start: number,
  end: number,
): SentenceSegment | null {
  let nextStart = start;
  let nextEnd = end;

  while (nextStart < nextEnd && /\s/.test(text[nextStart])) {
    nextStart += 1;
  }
  while (nextEnd > nextStart && /\s/.test(text[nextEnd - 1])) {
    nextEnd -= 1;
  }

  if (nextStart >= nextEnd) return null;

  return {
    text: text.slice(nextStart, nextEnd),
    start: nextStart,
    end: nextEnd,
  };
}

export function segmentSentences(value: string): SentenceSegment[] {
  const text = value.replace(/[\s\u00a0]+/g, " ").trim();
  if (!text) return [];

  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string | string[],
        options?: { granularity: "sentence" },
      ) => {
        segment(input: string): Iterable<{ segment: string; index: number }>;
      };
    }
  ).Segmenter;

  if (Segmenter) {
    const segmenter = new Segmenter("en", {
      granularity: "sentence",
    });
    const result: SentenceSegment[] = [];

    for (const item of segmenter.segment(text)) {
      const segment = trimSegment(
        text,
        item.index,
        item.index + item.segment.length,
      );
      if (segment) result.push(segment);
    }

    if (result.length > 0) return result;
  }

  const result: SentenceSegment[] = [];
  const regex = /[^.!?。！？]+(?:[.!?。！？]+["')\]”’]*|$)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const segment = trimSegment(
      text,
      match.index,
      match.index + match[0].length,
    );
    if (segment) result.push(segment);

    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  return result;
}

function segmentDomText(text: string): SentenceSegment[] {
  if (!text) return [];

  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string | string[],
        options?: { granularity: "sentence" },
      ) => {
        segment(input: string): Iterable<{ segment: string; index: number }>;
      };
    }
  ).Segmenter;

  if (Segmenter) {
    const segmenter = new Segmenter("en", {
      granularity: "sentence",
    });
    const result: SentenceSegment[] = [];

    for (const item of segmenter.segment(text)) {
      const segment = trimSegment(
        text,
        item.index,
        item.index + item.segment.length,
      );
      if (segment) result.push(segment);
    }

    if (result.length > 0) return result;
  }

  const result: SentenceSegment[] = [];
  const regex = /[^.!?。！？]+(?:[.!?。！？]+["')\]”’]*|$)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const segment = trimSegment(
      text,
      match.index,
      match.index + match[0].length,
    );
    if (segment) result.push(segment);

    if (match[0].length === 0) regex.lastIndex += 1;
  }

  return result;
}

function rangeForSegment(
  document: Document,
  model: DomTextModel,
  segment: SentenceSegment,
): Range | null {
  const start = model.points[segment.start];
  const end = model.points[segment.end - 1];
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, Math.min(end.node.data.length, end.offset + 1));
  return range;
}

function pointFromCoordinates(
  document: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  const pointDocument = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };

  const range = pointDocument.caretRangeFromPoint?.(x, y);
  if (range) {
    return {
      node: range.startContainer,
      offset: range.startOffset,
    };
  }

  const position = pointDocument.caretPositionFromPoint?.(x, y);
  return position
    ? {
        node: position.offsetNode,
        offset: position.offset,
      }
    : null;
}

function normalizedOffsetForPoint(
  model: DomTextModel,
  node: Node,
  offset: number,
): number | null {
  let bestBefore: number | null = null;
  let bestAfter: number | null = null;

  for (let index = 0; index < model.points.length; index += 1) {
    const point = model.points[index];
    if (point.node !== node) continue;

    if (point.offset <= offset) {
      bestBefore = index;
    } else if (bestAfter === null) {
      bestAfter = index;
    }
  }

  return bestBefore ?? bestAfter;
}

function selectRange(window: Window, range: Range) {
  const selection = window.getSelection();
  if (!selection) return;

  selection.removeAllRanges();
  selection.addRange(range);
}

export function selectDomSentenceAtPoint(
  document: Document,
  x: number,
  y: number,
  root: Node = document.body,
): DomSentenceSelection | null {
  const model = buildDomTextModel(root);
  const sentences = segmentDomText(model.text);
  const point = pointFromCoordinates(document, x, y);

  if (!point || sentences.length === 0) return null;

  const offset = normalizedOffsetForPoint(
    model,
    point.node,
    point.offset,
  );
  if (offset === null) return null;

  const index = sentences.findIndex(
    (sentence) =>
      offset >= sentence.start && offset < sentence.end,
  );
  if (index < 0) return null;

  return selectDomSentenceByIndex(document, index, root);
}

export function selectDomSentenceByIndex(
  document: Document,
  index: number,
  root: Node = document.body,
): DomSentenceSelection | null {
  const model = buildDomTextModel(root);
  const sentences = segmentDomText(model.text);
  const sentence = sentences[index];

  if (!sentence) return null;

  const range = rangeForSegment(document, model, sentence);
  const view = document.defaultView;
  if (!range || !view) return null;

  selectRange(view, range);

  return {
    text: sentence.text,
    context: model.text.slice(0, 9000),
    index,
    count: sentences.length,
    range,
  };
}
