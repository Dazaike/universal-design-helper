import {
  compositeCapture,
  computeCropBox,
  elementContextFrom,
  formatFilenameTimestamp,
  imageFilename,
  MAX_CANVAS_SIDE,
  planCaptureTiles,
  renderHandoffText,
  type CaptureModel,
  type CaptureTile,
  type ElementContext,
  type Stroke,
} from "../shared/export";
import { type BridgeExportPayload } from "../shared/mcp-bridge";

declare global {
  interface Window {
    __designHelperInstance?: { close: () => void };
  }
}

const INSTANCE_KEY = "__designHelperInstance";

type Mode = "idle" | "draw" | "select";
type CaptureResponse = { ok: true; dataUrl: string } | { ok: false; error: string };
type DownloadResponse =
  | { ok: true; id: number; filename: string }
  | { ok: false; error: string };

interface AttachedImage {
  id: string;
  blob: Blob;
  filename: string;
  previewUrl: string;
}

function sendMessage<T>(message: unknown): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  chrome.runtime.sendMessage(message, (response) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message));
    else resolve(response as T);
  });
  return promise;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
  reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not encode download artifact.")), { once: true });
  reader.readAsDataURL(blob);
  return promise;
}

function selectionSummary(contexts: ElementContext[]): string {
  if (!contexts.length) return "No element selected";
  if (contexts.length === 1) return `Target: <${contexts[0].tagName}> (${contexts[0].cssLocator})`;
  return `${contexts.length} targets:\n${contexts.map((c, i) => `${i + 1}. <${c.tagName}> (${c.cssLocator})`).join("\n")}`;
}

const CAPTURE_INTERVAL_MS = 520;

function mountOverlay(): void {
  if (window[INSTANCE_KEY]) {
    try { window[INSTANCE_KEY]?.close(); } catch {}
  }

  const host = document.createElement("div");
  host.id = "design-helper-host";
  host.style.cssText = "all: initial;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    #backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0); pointer-events: none; transition: background 0.3s ease; z-index: 2147483646; }
    #backdrop.active { background: rgba(0, 0, 0, 0.65); }
    #surface { position: fixed; inset: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #f4f4f5; pointer-events: none; z-index: 2147483647; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; touch-action: none; z-index: 2; }
    #toolbar {
      position: fixed; top: 20px; right: 20px; width: min(380px, calc(100vw - 40px));
      padding: 16px; border: 1px solid #27272a; border-radius: 12px;
      background: #09090b; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.75);
      pointer-events: auto; z-index: 10; transition: border-color 0.2s ease, opacity 0.05s ease;
    }
    #toolbar.drag-over { border-color: #38bdf8; }
    .capturing, .capturing * { transition: none !important; }
    .drag-handle {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      cursor: grab; margin: -16px -16px 12px -16px; padding: 8px 16px;
      border-bottom: 1px solid #27272a; border-radius: 12px 12px 0 0;
      background: #111113; color: #71717a; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.08em; touch-action: none; user-select: none;
    }
    .drag-handle:active { cursor: grabbing; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    button {
      appearance: none; border: 1px solid #27272a; border-radius: 8px;
      background: #18181b; color: #f4f4f5; padding: 8px 12px; font: inherit; font-weight: 500;
      cursor: pointer; transition: all 0.18s ease; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    }
    button:hover:not(:disabled) { background: #27272a; border-color: #3f3f46; transform: translateY(-1px); }
    button:active:not(:disabled) { transform: translateY(0); }
    button.active { background: #0284c7; border-color: #38bdf8; color: #ffffff; }
    button.primary { background: #059669; border-color: #10b981; font-weight: 600; width: 100%; color: #ffffff; }
    button.primary:hover:not(:disabled) { background: #047857; }
    #dh-alt-mcp-toggle { width: 100%; }
    button.close { margin-left: auto; background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5; }
    button.close:hover:not(:disabled) { background: #dc2626; color: #fff; border-color: #ef4444; }
    button:disabled { opacity: 0.65; cursor: not-allowed; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid rgba(255, 255, 255, 0.35); border-radius: 50%; border-top-color: #ffffff; animation: spin 0.6s linear infinite; }
    textarea {
      box-sizing: border-box; width: 100%; min-height: 90px; resize: vertical; padding: 10px 12px;
      border: 1px solid #27272a; border-radius: 8px; background: #18181b;
      color: #f4f4f5; font: inherit; transition: border-color 0.2s ease; margin-bottom: 8px;
    }
    textarea:focus { outline: none; border-color: #38bdf8; }
    label { display: block; margin-bottom: 6px; font-weight: 600; color: #a1a1aa; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    #attachments-preview { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .attachment-card { position: relative; width: 50px; height: 50px; border-radius: 8px; overflow: hidden; border: 1px solid #27272a; background: #18181b; }
    .attachment-card img { width: 100%; height: 100%; object-fit: cover; }
    .attachment-card .remove-btn {
      position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: rgba(239, 68, 68, 0.9); color: #fff; border: none; font-size: 10px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1;
    }
    .attachment-card .remove-btn:hover { background: #dc2626; }
    #selection { font-size: 12px; color: #a1a1aa; margin-bottom: 8px; word-break: break-all; white-space: pre-line; max-height: 120px; overflow-y: auto; }
    #status { font-size: 12px; margin-bottom: 10px; min-height: 18px; line-height: 1.4; transition: opacity 0.2s ease; }
    #status.error { color: #fca5a5; font-weight: 500; }
    #status.success { color: #86efac; font-weight: 500; }
    #hover-highlight { display: none; position: fixed; box-sizing: border-box; border: 2px dashed #38bdf8; background: rgba(56, 189, 248, 0.15); pointer-events: none; transition: all 0.05s ease-out; z-index: 5; }
    .locked-highlight { position: fixed; box-sizing: border-box; border: 2px solid #00e5ff; background: rgba(0, 229, 255, 0.15); pointer-events: none; z-index: 6; }
  `;
  const backdrop = document.createElement("div");
  backdrop.id = "backdrop";
  const surface = document.createElement("div");
  surface.id = "surface";
  const canvas = document.createElement("canvas");
  const hoverHighlight = document.createElement("div");
  hoverHighlight.id = "hover-highlight";
  const lockedLayer = document.createElement("div");
  lockedLayer.id = "locked-layer";
  const toolbar = document.createElement("section");
  toolbar.id = "toolbar";
  toolbar.innerHTML = `
    <div class="drag-handle" id="drag-handle">⋮⋮ Design Helper</div>
    <div class="row">
      <button type="button" data-mode="draw">Draw</button>
      <button type="button" data-mode="select">Select element</button>
      <button type="button" data-action="attach">Attach</button>
      <button type="button" data-action="undo">Undo</button>
      <button type="button" class="close" data-action="close">✕</button>
    </div>
    <div class="row">
      <button type="button" data-action="toggle-alt-mcp" id="dh-alt-mcp-toggle">Enable Alt+Click + MCP</button>
    </div>
    <input type="file" id="dh-file-input" accept="image/*" multiple style="display:none" />
    <label for="dh-request">Change Request</label>
    <textarea id="dh-request" placeholder="Describe requested change... (Paste Ctrl+V or drop images)"></textarea>
    <div id="attachments-preview"></div>
    <div id="selection">No element selected</div>
    <div id="status" role="status"></div>
    <div class="row"><button type="button" class="primary" data-action="export">Export</button></div>
  `;
  surface.append(canvas, hoverHighlight, lockedLayer, toolbar);
  shadow.append(style, backdrop, surface);
  (document.body || document.documentElement).append(host);
  const getContext = () => canvas.getContext("2d");
  const requestInput = toolbar.querySelector<HTMLTextAreaElement>("#dh-request")!;
  const fileInput = toolbar.querySelector<HTMLInputElement>("#dh-file-input")!;
  const attachmentsPreview = toolbar.querySelector<HTMLElement>("#attachments-preview")!;
  const selectionText = toolbar.querySelector<HTMLElement>("#selection")!;
  const status = toolbar.querySelector<HTMLElement>("#status")!;
  const drawButton = toolbar.querySelector<HTMLButtonElement>('[data-mode="draw"]')!;
  const selectButton = toolbar.querySelector<HTMLButtonElement>('[data-mode="select"]')!;
  const exportButton = toolbar.querySelector<HTMLButtonElement>('[data-action="export"]')!;
  const altMcpButton = toolbar.querySelector<HTMLButtonElement>("#dh-alt-mcp-toggle")!;

  let mode: Mode = "idle";
  let strokes: Stroke[] = [];
  let activeStroke: Stroke | null = null;
  let selected: Array<{ element: Element; context: ElementContext }> = [];
  let attachments: AttachedImage[] = [];
  let disposed = false;
  let altClickMcpEnabled = false;

  const showStatus = (message: string, kind: "error" | "success" | "") => {
    status.textContent = message;
    status.className = kind;
  };
  const setAltClickMcpEnabled = (enabled: boolean) => {
    altClickMcpEnabled = enabled;
    altMcpButton.classList.toggle("active", enabled);
    altMcpButton.textContent = enabled ? "Alt+Click + MCP: ON" : "Enable Alt+Click + MCP";
    showStatus(enabled ? "Alt+Click any element to capture it and send it to your coding agent via MCP." : "Alt+Click + MCP disabled.", "");
  };

  const addAttachment = (blob: Blob, filename: string) => {
    const id = Math.random().toString(36).slice(2, 9);
    const previewUrl = URL.createObjectURL(blob);
    attachments.push({ id, blob, filename, previewUrl });
    renderAttachments();
  };

  const removeAttachment = (id: string) => {
    const index = attachments.findIndex((a) => a.id === id);
    if (index !== -1) {
      URL.revokeObjectURL(attachments[index].previewUrl);
      attachments.splice(index, 1);
      renderAttachments();
    }
  };

  const renderAttachments = () => {
    attachmentsPreview.innerHTML = "";
    attachments.forEach((att) => {
      const card = document.createElement("div");
      card.className = "attachment-card";
      const img = document.createElement("img");
      img.src = att.previewUrl;
      img.alt = att.filename;
      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.type = "button";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeAttachment(att.id);
      });
      card.append(img, removeBtn);
      attachmentsPreview.append(card);
    });
  };

  const handlePaste = (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    let imageCount = 0;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          imageCount++;
          addAttachment(file, `pasted-${Date.now()}-${imageCount}.png`);
        }
      }
    }
    if (imageCount > 0) {
      showStatus(`${imageCount} image(s) attached from clipboard.`, "success");
    }
  };

  const handleDroppedFiles = (files: FileList | null | undefined) => {
    if (!files || !files.length) return;
    let imageCount = 0;
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        imageCount++;
        addAttachment(file, file.name);
      }
    }
    if (imageCount > 0) {
      showStatus(`${imageCount} file(s) attached.`, "success");
    }
  };

  fileInput.addEventListener("change", () => {
    handleDroppedFiles(fileInput.files);
    fileInput.value = "";
  });

  toolbar.addEventListener("dragover", (e) => {
    e.preventDefault();
    toolbar.classList.add("drag-over");
  });
  toolbar.addEventListener("dragleave", (e) => {
    e.preventDefault();
    toolbar.classList.remove("drag-over");
  });
  toolbar.addEventListener("drop", (e) => {
    e.preventDefault();
    toolbar.classList.remove("drag-over");
    handleDroppedFiles(e.dataTransfer?.files);
  });
  const dragHandle = toolbar.querySelector<HTMLElement>("#drag-handle")!;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  dragHandle.addEventListener("pointerdown", (event: PointerEvent) => {
    isDragging = true;
    const rect = toolbar.getBoundingClientRect();
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    initialLeft = rect.left;
    initialTop = rect.top;
    toolbar.style.right = "auto";
    toolbar.style.left = `${initialLeft}px`;
    toolbar.style.top = `${initialTop}px`;
    event.preventDefault();
  });

  const handleDragPointerMove = (event: PointerEvent) => {
    if (!isDragging) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    const maxLeft = Math.max(10, window.innerWidth - toolbar.offsetWidth - 10);
    const maxTop = Math.max(10, window.innerHeight - toolbar.offsetHeight - 10);
    const newLeft = Math.max(10, Math.min(maxLeft, initialLeft + dx));
    const newTop = Math.max(10, Math.min(maxTop, initialTop + dy));
    toolbar.style.left = `${newLeft}px`;
    toolbar.style.top = `${newTop}px`;
  };

  const stopDragging = () => {
    isDragging = false;
  };

  window.addEventListener("pointermove", handleDragPointerMove);
  window.addEventListener("pointerup", stopDragging);
  window.addEventListener("pointercancel", stopDragging);
  const stopHostEvent = (e: Event) => {
    e.stopPropagation();
  };

  // Stop keyboard/input events from leaking to host page shortcuts while inside overlay
  [
    "keydown",
    "keyup",
    "keypress",
    "beforeinput",
    "input",
    "compositionstart",
    "compositionupdate",
    "compositionend",
  ].forEach((type) => {
    host.addEventListener(type, stopHostEvent, true);
  });

  // On mousedown/pointerdown inside toolbar, prevent default on non-inputs to preserve current page focus without firing page-level blur/clickoutside
  toolbar.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    const target = e.target as Element;
    if (!target.closest("textarea, input")) {
      e.preventDefault();
    }
  });

  toolbar.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    const target = e.target as Element;
    if (!target.closest("textarea, input")) {
      e.preventDefault();
    }
  });



  const redraw = () => {
    const ctx = getContext();
    if (!ctx) return;
    const dpr = window.devicePixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Strokes live in page coordinates; shift by the current scroll so they stay glued to the content.
    ctx.setTransform(dpr, 0, 0, dpr, -window.scrollX * dpr, -window.scrollY * dpr);
    ctx.strokeStyle = "#ff2d55";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
      if (!stroke.points.length) continue;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  };

  const resizeCanvas = () => {
    const dpr = window.devicePixelRatio;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    redraw();
  };

  const updateLockedHighlight = () => {
    lockedLayer.replaceChildren();
    selected.forEach(({ element }, index) => {
      if (!element.isConnected) return;
      const rect = element.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "locked-highlight";
      box.dataset.index = String(index + 1);
      box.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;`;
      lockedLayer.append(box);
    });
  };
  const refreshSelection = () => {
    selected = selected.filter(({ element }) => element.isConnected);
    for (const s of selected) {
      const { x, y, width, height } = s.element.getBoundingClientRect();
      s.context.rect = { x, y, width, height };
    }
    selectionText.textContent = selectionSummary(selected.map((s) => s.context));
    updateLockedHighlight();
  };

  const isEventOverToolbar = (event: Event): boolean => {
    const path = event.composedPath();
    return path.includes(toolbar);
  };

  const handlePointerHover = (event: MouseEvent) => {
    if (mode !== "select" || disposed) return;
    if (isEventOverToolbar(event)) {
      hoverHighlight.style.display = "none";
      return;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === host || host.contains(target) || target === document.documentElement || target === document.body) {
      hoverHighlight.style.display = "none";
      return;
    }
    const rect = target.getBoundingClientRect();
    hoverHighlight.style.cssText = `display:block;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;`;
  };

  const setMode = (next: Mode) => {
    mode = next;
    canvas.style.pointerEvents = next === "draw" ? "auto" : "none";
    backdrop.classList.toggle("active", next === "draw");
    drawButton.classList.toggle("active", next === "draw");
    selectButton.classList.toggle("active", next === "select");
    if (next !== "select") hoverHighlight.style.display = "none";
    if (next === "select") showStatus("Click elements to select or deselect them. Click Select element again when done.", "");
  };

  const handleScroll = () => {
    if (disposed) return;
    updateLockedHighlight();
    redraw();
  };

  const close = () => {
    if (disposed) return;
    disposed = true;
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    window.removeEventListener("pointermove", handleDragPointerMove);
    window.removeEventListener("pointerup", stopDragging);
    window.removeEventListener("pointercancel", stopDragging);
    window.removeEventListener("resize", resizeCanvas);
    window.removeEventListener("resize", handleScroll);
    window.removeEventListener("scroll", handleScroll, true);
    document.removeEventListener("pointermove", handlePointerHover, true);
    PRESS_EVENTS.forEach((name) => window.removeEventListener(name, swallowPagePress, true));
    document.removeEventListener("click", handlePageClick, true);
    document.removeEventListener("paste", handlePaste, true);
    canvas.removeEventListener("pointerdown", beginStroke);
    canvas.removeEventListener("pointermove", extendStroke);
    canvas.removeEventListener("pointerup", endStroke);
    canvas.removeEventListener("pointercancel", endStroke);
    toolbar.removeEventListener("click", handleToolbarClick);
    delete window[INSTANCE_KEY];
    host.remove();
  };

  const sendSelectionToMcp = async (contexts: ElementContext[]) => {
    showStatus("Element selected via Alt+Click. Sending to MCP…", "");
    try {
      const bridgePayload: BridgeExportPayload = {
        imagePaths: [],
        request: requestInput.value.trim(),
        elementContexts: contexts,
        pageUrl: location.href,
        timestamp: new Date().toISOString(),
        images: [],
      };
      const bridgeResult = await sendMessage<{ ok: true } | { ok: false; error: string }>({
        type: "post-design-handoff",
        payload: bridgePayload,
      });
      if (bridgeResult.ok) {
        showStatus("Element selected. Sent to MCP.", "success");
      } else {
        showStatus(`Element selected, but MCP send failed: ${bridgeResult.error}`, "error");
      }
    } catch (error) {
      showStatus(`Element selected, but MCP send failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };

  // Page menus/popovers close on pointerdown/mousedown (outside-click). Swallow the press
  // events in select mode so only our click handler sees the interaction.
  const swallowPagePress = (event: Event) => {
    if (disposed || mode !== "select") return;
    if (isEventOverToolbar(event)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const PRESS_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"] as const;

  const handlePageClick = (event: MouseEvent) => {
    if (disposed) return;
    const altTrigger = altClickMcpEnabled && event.altKey;
    if (mode !== "select" && !altTrigger) return;
    if (isEventOverToolbar(event)) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === host || host.contains(target) || target === document.documentElement || target === document.body) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const existing = selected.findIndex((s) => s.element === target);
    if (existing !== -1) {
      selected.splice(existing, 1);
    } else {
      selected.push({ element: target, context: elementContextFrom(target, location.href, host) });
    }
    refreshSelection();
    const contexts = selected.map((s) => s.context);
    if (altTrigger) {
      void sendSelectionToMcp(contexts);
    } else {
      showStatus(existing !== -1 ? `Deselected. ${contexts.length} selected.` : `${contexts.length} selected.`, "success");
    }
  };

  const beginStroke = (event: PointerEvent) => {
    if (mode !== "draw") return;
    event.preventDefault();
    event.stopPropagation();
    canvas.setPointerCapture(event.pointerId);
    activeStroke = { points: [{ x: event.clientX + window.scrollX, y: event.clientY + window.scrollY }] };
    strokes.push(activeStroke);
    redraw();
  };

  const extendStroke = (event: PointerEvent) => {
    if (!activeStroke) return;
    event.preventDefault();
    activeStroke.points.push({ x: event.clientX + window.scrollX, y: event.clientY + window.scrollY });
    redraw();
  };

  const endStroke = (event: PointerEvent) => {
    if (!activeStroke) return;
    event.preventDefault();
    if (activeStroke.points.length === 1) activeStroke.points.push({ ...activeStroke.points[0] });
    activeStroke = null;
  };

  const exportChanges = async () => {
    const request = requestInput.value.trim();
    refreshSelection();
    if (!request && !selected.length && !strokes.length && !attachments.length) {
      requestInput.focus();
      showStatus("Add a request, stroke, element, or image first.", "error");
      return;
    }
    const elementContexts = selected.map((s) => s.context);
    const timestamp = new Date();
    const scrollX0 = window.scrollX;
    const scrollY0 = window.scrollY;
    const model: CaptureModel = {
      request,
      pageUrl: location.href,
      timestamp,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      page: {
        width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
        height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      },
      scroll: { x: scrollX0, y: scrollY0 },
      strokes,
      elementRects: selected.map(({ context: { rect } }) => ({ x: rect.x + scrollX0, y: rect.y + scrollY0, width: rect.width, height: rect.height })),
    };
    const crop = computeCropBox(model);
    if (crop.width * model.viewport.devicePixelRatio > MAX_CANVAS_SIDE || crop.height * model.viewport.devicePixelRatio > MAX_CANVAS_SIDE) {
      showStatus("Selection spans too much of the page for one image. Select a smaller span.", "error");
      return;
    }

    exportButton.disabled = true;
    exportButton.innerHTML = `<span class="spinner"></span> Processing...`;
    showStatus("Exporting & capturing webpage...", "");

    try {
      const tiles: CaptureTile[] = [];
      const seen = new Set<string>();
      let lastCaptureAt = 0;
      // !important so it beats the inline `all: initial` on the host.
      host.style.setProperty("display", "none", "important");
      try {
        for (const position of planCaptureTiles(crop, model.viewport)) {
          window.scrollTo({ left: position.x, top: position.y, behavior: "instant" });
          const key = `${window.scrollX},${window.scrollY}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const { promise: painted, resolve: resolvePainted } = Promise.withResolvers<void>();
          requestAnimationFrame(() => requestAnimationFrame(() => resolvePainted()));
          await painted;
          // captureVisibleTab is rate limited (~2 calls/s); also lets lazy content settle after scrolling.
          const wait = Math.max(100, CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt));
          const { promise: settled, resolve: resolveSettled } = Promise.withResolvers<void>();
          setTimeout(resolveSettled, wait);
          await settled;
          const capture = await sendMessage<CaptureResponse>({ type: "capture-visible-tab" });
          lastCaptureAt = Date.now();
          if (!capture.ok) throw new Error(capture.error);
          tiles.push({ blob: await (await fetch(capture.dataUrl)).blob(), scrollX: window.scrollX, scrollY: window.scrollY });
        }
      } finally {
        window.scrollTo({ left: scrollX0, top: scrollY0, behavior: "instant" });
        host.style.removeProperty("display");
      }

      const imageBlob = await compositeCapture(tiles, model);
      const imageName = imageFilename(timestamp);
      const imageDataUrl = await blobToDataUrl(imageBlob);

      const websiteImageDownload = await sendMessage<DownloadResponse>({
        type: "download-image",
        imageUrl: imageDataUrl,
        imageFilename: imageName,
      });
      if (!websiteImageDownload.ok) throw new Error(`PNG download failed: ${websiteImageDownload.error}`);

      const imagePaths: string[] = [websiteImageDownload.filename];
      const bridgeImages: BridgeExportPayload["images"] = [{ filename: imageName, dataUrl: imageDataUrl }];

      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        const ext = att.filename.endsWith(".jpg") || att.filename.endsWith(".jpeg") ? "jpg" : "png";
        const attFilename = `${formatFilenameTimestamp(timestamp)}-attachment-${i + 1}.${ext}`;
        const attDataUrl = await blobToDataUrl(att.blob);
        const attDownload = await sendMessage<DownloadResponse>({
          type: "download-image",
          imageUrl: attDataUrl,
          imageFilename: attFilename,
        });
        if (attDownload.ok) {
          imagePaths.push(attDownload.filename);
          bridgeImages.push({ filename: attFilename, dataUrl: attDataUrl });
        }
      }

      const handoffText = renderHandoffText(imagePaths, request, elementContexts);
      let clipboardMessage = "Handoff copied to clipboard!";
      try {
        await navigator.clipboard.writeText(handoffText);
      } catch {
        clipboardMessage = "Images saved, but clipboard write failed.";
      }

      let bridgeSuffix = "";
      try {
        const bridgePayload: BridgeExportPayload = {
          imagePaths,
          request,
          elementContexts,
          pageUrl: location.href,
          timestamp: timestamp.toISOString(),
          images: bridgeImages,
        };
        const bridgeResult = await sendMessage<{ ok: true } | { ok: false; error: string }>({
          type: "post-design-handoff",
          payload: bridgePayload,
        });
        if (bridgeResult.ok) bridgeSuffix = " MCP bridge updated.";
      } catch {
        // MCP bridge server isn't running; the download and clipboard handoff already succeeded.
      }

      showStatus(`${clipboardMessage} Saved ${imagePaths.length} image(s) to Downloads.${bridgeSuffix}`, "success");
    } catch (error) {
      showStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      exportButton.disabled = false;
      exportButton.innerHTML = `Export`;
    }
  };

  const handleToolbarClick = (event: MouseEvent) => {
    event.stopPropagation();
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
    const nextMode = button.dataset.mode as Mode | undefined;
    if (nextMode) { setMode(mode === nextMode ? "idle" : nextMode); return; }
    if (button.dataset.action === "attach") {
      fileInput.click();
      return;
    }
    if (button.dataset.action === "toggle-alt-mcp") {
      setAltClickMcpEnabled(!altClickMcpEnabled);
      return;
    }
    if (button.dataset.action === "undo") {
      if (strokes.length) strokes = strokes.slice(0, -1);
      else if (selected.length) { selected.pop(); refreshSelection(); }
      redraw();
      return;
    }
    if (button.dataset.action === "close") close();
    if (button.dataset.action === "export") void exportChanges();
  };

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("resize", handleScroll);
  window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
  document.addEventListener("pointermove", handlePointerHover, true);
  PRESS_EVENTS.forEach((name) => window.addEventListener(name, swallowPagePress, true));
  document.addEventListener("click", handlePageClick, true);
  document.addEventListener("paste", handlePaste, true);
  canvas.addEventListener("pointerdown", beginStroke);
  canvas.addEventListener("pointermove", extendStroke);
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  toolbar.addEventListener("click", handleToolbarClick);
  resizeCanvas();
  window[INSTANCE_KEY] = { close };
}

mountOverlay();
