export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementContext {
  pageUrl: string;
  rect: ViewportRect;
  tagName: string;
  id: string | null;
  classList: string[];
  attributes: Record<string, string>;
  visibleText: string;
  cssLocator: string;
  outerHtml: string;
  computedStyle: Record<string, string>;
}

export interface Stroke {
  points: Array<{ x: number; y: number }>;
}

export interface CaptureModel {
  request: string;
  pageUrl: string;
  timestamp: Date;
  viewport: { width: number; height: number; devicePixelRatio: number };
  strokes: Stroke[];
  /** Page-space (document) coordinates. */
  elementRects: ViewportRect[];
  page: { width: number; height: number };
  scroll: { x: number; y: number };
}

const MAX_TEXT = 2_000;
const MAX_HTML = 20_000;
const SENSITIVE_ATTRIBUTE = /(?:password|pass|token|secret|key|auth|credential|session|cookie)/i;
const STYLE_PROPERTIES = [
  "display", "box-sizing", "width", "height", "min-width", "max-width", "min-height", "max-height",
  "margin", "padding", "font-family", "font-size", "font-weight", "font-style", "line-height",
  "letter-spacing", "color", "background-color", "border", "border-radius", "gap", "justify-content",
  "align-items", "position", "top", "right", "bottom", "left", "z-index",
] as const;

export function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}[truncated]`;
}

function isValidId(id: string): boolean {
  return id.length > 0 && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id);
}

export function cssLocator(element: Element, overlayHost?: Element): string {
  if (element.id && isValidId(element.id)) return `#${element.id}`;

  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement && current !== overlayHost) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((child) => child.tagName === current!.tagName)
      : [];
    const index = siblings.indexOf(current) + 1;
    segments.unshift(`${tag}:nth-of-type(${Math.max(index, 1)})`);
    if (current.parentElement?.id && isValidId(current.parentElement.id)) {
      segments.unshift(`#${current.parentElement.id}`);
      break;
    }
    current = current.parentElement;
  }
  return segments.join(" > ");
}

export function elementContextFrom(element: Element, pageUrl: string, overlayHost?: Element): ElementContext {
  const rect = element.getBoundingClientRect();
  const attributes = Object.fromEntries(
    Array.from(element.attributes)
      .filter((attribute) => !SENSITIVE_ATTRIBUTE.test(attribute.name))
      .map((attribute) => [attribute.name, bounded(attribute.value, 500)]),
  );
  const style = getComputedStyle(element);
  const computedStyle = Object.fromEntries(STYLE_PROPERTIES.map((name) => [name, style.getPropertyValue(name)]));

  return {
    pageUrl,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classList: Array.from(element.classList),
    attributes,
    visibleText: bounded((element.textContent ?? "").trim(), MAX_TEXT),
    cssLocator: cssLocator(element, overlayHost),
    outerHtml: bounded(element.outerHTML, MAX_HTML),
    computedStyle,
  };
}

export function formatFilenameTimestamp(timestamp: Date): string {
  return timestamp.toISOString().replace(/[:.]/g, "-");
}

export function imageFilename(timestamp: Date): string {
  return `${formatFilenameTimestamp(timestamp)}-annotated.png`;
}

function axisPositions(start: number, length: number, view: number): number[] {
  const positions: number[] = [];
  for (let p = start; ; p += view) {
    positions.push(p);
    if (p + view >= start + length) break;
  }
  return positions;
}

/** Scroll offsets whose viewport-sized captures cover the crop box. */
export function planCaptureTiles(crop: ViewportRect, viewport: { width: number; height: number }): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (const y of axisPositions(crop.y, crop.height, viewport.height)) {
    for (const x of axisPositions(crop.x, crop.width, viewport.width)) tiles.push({ x, y });
  }
  return tiles;
}

/** Page-space box spanning every stroke and selected element (plus padding), clamped to the document. */
export function computeCropBox(model: CaptureModel): ViewportRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of model.strokes) {
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  for (const r of model.elementRects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }

  if (!isFinite(minX)) {
    return { x: model.scroll.x, y: model.scroll.y, width: model.viewport.width, height: model.viewport.height };
  }

  const padding = 30;
  const x = Math.max(0, Math.floor(minX - padding));
  const y = Math.max(0, Math.floor(minY - padding));
  const rX = Math.min(model.page.width, Math.ceil(maxX + padding));
  const rY = Math.min(model.page.height, Math.ceil(maxY + padding));

  return {
    x,
    y,
    width: Math.max(50, rX - x),
    height: Math.max(50, rY - y),
  };
}

export function renderHandoffText(
  imagePaths: string | string[],
  request: string,
  elementContexts: ElementContext[]
): string {
  const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
  const imagesPart = paths.map((p) => `@"${p}"`).join(" ");
  const reqPart = request.trim();
  const ctxPart = elementContexts.length
    ? JSON.stringify(elementContexts.length === 1 ? elementContexts[0] : elementContexts, null, 2)
    : "";

  if (reqPart && ctxPart) {
    return `${imagesPart}  ${reqPart}\n\n${ctxPart}`;
  }
  if (reqPart) {
    return `${imagesPart}  ${reqPart}`;
  }
  if (ctxPart) {
    return `${imagesPart}\n\n${ctxPart}`;
  }
  return `${imagesPart}`;
}

export interface CaptureTile {
  blob: Blob;
  scrollX: number;
  scrollY: number;
}

export const MAX_CANVAS_SIDE = 16_384;

export async function compositeCapture(tiles: CaptureTile[], model: CaptureModel): Promise<Blob> {
  const dpr = model.viewport.devicePixelRatio;
  const crop = computeCropBox(model);
  const width = Math.round(crop.width * dpr);
  const height = Math.round(crop.height * dpr);
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE) {
    throw new Error("The selected area is too large to capture as one image. Select a smaller span.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");

  for (const tile of tiles) {
    const bitmap = await createImageBitmap(tile.blob);
    context.drawImage(
      bitmap,
      Math.round((tile.scrollX - crop.x) * dpr),
      Math.round((tile.scrollY - crop.y) * dpr),
      Math.round(model.viewport.width * dpr),
      Math.round(model.viewport.height * dpr)
    );
    bitmap.close();
  }

  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#ff2d55";
  context.lineWidth = 4 * dpr;
  for (const stroke of model.strokes) {
    if (!stroke.points.length) continue;
    context.beginPath();
    context.moveTo((stroke.points[0].x - crop.x) * dpr, (stroke.points[0].y - crop.y) * dpr);
    for (const point of stroke.points.slice(1)) {
      context.lineTo((point.x - crop.x) * dpr, (point.y - crop.y) * dpr);
    }
    context.stroke();
  }

  context.fillStyle = "rgba(0, 229, 255, 0.22)";
  for (const rect of model.elementRects) {
    context.fillRect((rect.x - crop.x) * dpr, (rect.y - crop.y) * dpr, rect.width * dpr, rect.height * dpr);
  }

  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))), "image/png");
  return promise;
}
