import {
  compositeCapture,
  elementContextFrom,
  formatFilenameTimestamp,
  imageFilename,
  renderHandoffText,
  type ElementContext,
  type Stroke,
} from "../shared/export";

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

function selectionSummary(context: ElementContext | null): string {
  return context ? `Target: <${context.tagName}> (${context.cssLocator})` : "No element selected";
}

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
    #selection { font-size: 12px; color: #a1a1aa; margin-bottom: 8px; word-break: break-all; }
    #status { font-size: 12px; margin-bottom: 10px; min-height: 18px; line-height: 1.4; transition: opacity 0.2s ease; }
    #status.error { color: #fca5a5; font-weight: 500; }
    #status.success { color: #86efac; font-weight: 500; }
    #hover-highlight { display: none; position: fixed; box-sizing: border-box; border: 2px dashed #38bdf8; background: rgba(56, 189, 248, 0.15); pointer-events: none; transition: all 0.05s ease-out; z-index: 5; }
    #locked-highlight { display: none; position: fixed; box-sizing: border-box; border: 2px solid #00e5ff; background: rgba(0, 229, 255, 0.15); pointer-events: none; z-index: 6; }
  `;
  const backdrop = document.createElement("div");
  backdrop.id = "backdrop";
  const surface = document.createElement("div");
  surface.id = "surface";
  const canvas = document.createElement("canvas");
  const hoverHighlight = document.createElement("div");
  hoverHighlight.id = "hover-highlight";
  const lockedHighlight = document.createElement("div");
  lockedHighlight.id = "locked-highlight";
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
    <input type="file" id="dh-file-input" accept="image/*" multiple style="display:none" />
    <label for="dh-request">Change Request</label>
    <textarea id="dh-request" placeholder="Describe requested change... (Paste Ctrl+V or drop images)"></textarea>
    <div id="attachments-preview"></div>
    <div id="selection">No element selected</div>
    <div id="status" role="status"></div>
    <div class="row"><button type="button" class="primary" data-action="export">Export</button></div>
  `;
  surface.append(canvas, hoverHighlight, lockedHighlight, toolbar);
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

  let mode: Mode = "idle";
  let strokes: Stroke[] = [];
  let activeStroke: Stroke | null = null;
  let selected: { element: Element; context: ElementContext } | null = null;
  let attachments: AttachedImage[] = [];
  let disposed = false;

  const showStatus = (message: string, kind: "error" | "success" | "") => {
    status.textContent = message;
    status.className = kind;
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
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
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
    const ctx = getContext();
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }
  };

  const updateLockedHighlight = () => {
    if (!selected || !selected.element.isConnected) {
      lockedHighlight.style.display = "none";
      return;
    }
    const rect = selected.element.getBoundingClientRect();
    lockedHighlight.style.cssText = `display:block;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;`;
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
    if (next === "select") showStatus("Hover & click any element on the page.", "");
  };

  const close = () => {
    if (disposed) return;
    disposed = true;
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    window.removeEventListener("pointermove", handleDragPointerMove);
    window.removeEventListener("pointerup", stopDragging);
    window.removeEventListener("pointercancel", stopDragging);
    window.removeEventListener("resize", resizeCanvas);
    document.removeEventListener("pointermove", handlePointerHover, true);
    document.removeEventListener("click", selectElement, true);
    document.removeEventListener("paste", handlePaste, true);
    canvas.removeEventListener("pointerdown", beginStroke);
    canvas.removeEventListener("pointermove", extendStroke);
    canvas.removeEventListener("pointerup", endStroke);
    canvas.removeEventListener("pointercancel", endStroke);
    toolbar.removeEventListener("click", handleToolbarClick);
    delete window[INSTANCE_KEY];
    host.remove();
  };

  const selectElement = (event: MouseEvent) => {
    if (mode !== "select" || disposed) return;
    if (isEventOverToolbar(event)) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === host || host.contains(target) || target === document.documentElement || target === document.body) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selected = { element: target, context: elementContextFrom(target, location.href, host) };
    selectionText.textContent = selectionSummary(selected.context);
    hoverHighlight.style.display = "none";
    setMode("idle");
    updateLockedHighlight();
    showStatus("Element selected.", "success");
  };

  const beginStroke = (event: PointerEvent) => {
    if (mode !== "draw") return;
    event.preventDefault();
    event.stopPropagation();
    canvas.setPointerCapture(event.pointerId);
    activeStroke = { points: [{ x: event.clientX, y: event.clientY }] };
    strokes.push(activeStroke);
    redraw();
  };

  const extendStroke = (event: PointerEvent) => {
    if (!activeStroke) return;
    event.preventDefault();
    activeStroke.points.push({ x: event.clientX, y: event.clientY });
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
    if (!request && !selected && !strokes.length && !attachments.length) {
      requestInput.focus();
      showStatus("Add a request, stroke, element, or image first.", "error");
      return;
    }
    if (selected && !selected.element.isConnected) {
      selected = null;
      selectionText.textContent = "No element selected";
      lockedHighlight.style.display = "none";
    }
    const timestamp = new Date();
    const model = {
      request,
      pageUrl: location.href,
      timestamp,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      strokes,
      elementContext: selected?.context ?? null,
    };

    exportButton.disabled = true;
    exportButton.innerHTML = `<span class="spinner"></span> Processing...`;
    showStatus("Exporting & capturing webpage...", "");

    let captureDataUrl: string | null = null;
    try {
      surface.classList.add("capturing");
      backdrop.classList.add("capturing");
      canvas.style.opacity = "0";
      toolbar.style.opacity = "0";
      backdrop.style.opacity = "0";
      hoverHighlight.style.opacity = "0";
      lockedHighlight.style.opacity = "0";
      const { promise: painted, resolve: resolvePainted } = Promise.withResolvers<void>();
      requestAnimationFrame(() => requestAnimationFrame(() => resolvePainted()));
      await painted;
      const capture = await sendMessage<CaptureResponse>({ type: "capture-visible-tab" });
      if (!capture.ok) throw new Error(capture.error);
      captureDataUrl = capture.dataUrl;
    } finally {
      canvas.style.opacity = "1";
      toolbar.style.opacity = "1";
      backdrop.style.opacity = "1";
      hoverHighlight.style.opacity = "1";
      lockedHighlight.style.opacity = "1";
      surface.classList.remove("capturing");
      backdrop.classList.remove("capturing");
    }

    try {
      const imageBlob = await compositeCapture(await (await fetch(captureDataUrl)).blob(), model);
      const imageName = imageFilename(timestamp);

      const websiteImageDownload = await sendMessage<DownloadResponse>({
        type: "download-image",
        imageUrl: await blobToDataUrl(imageBlob),
        imageFilename: imageName,
      });
      if (!websiteImageDownload.ok) throw new Error(`PNG download failed: ${websiteImageDownload.error}`);

      const imagePaths: string[] = [websiteImageDownload.filename];

      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        const ext = att.filename.endsWith(".jpg") || att.filename.endsWith(".jpeg") ? "jpg" : "png";
        const attFilename = `${formatFilenameTimestamp(timestamp)}-attachment-${i + 1}.${ext}`;
        const attDownload = await sendMessage<DownloadResponse>({
          type: "download-image",
          imageUrl: await blobToDataUrl(att.blob),
          imageFilename: attFilename,
        });
        if (attDownload.ok) {
          imagePaths.push(attDownload.filename);
        }
      }

      const handoffText = renderHandoffText(imagePaths, request, selected?.context ?? null);
      let clipboardMessage = "Handoff copied to clipboard!";
      try {
        await navigator.clipboard.writeText(handoffText);
      } catch {
        clipboardMessage = "Images saved, but clipboard write failed.";
      }
      showStatus(`${clipboardMessage} Saved ${imagePaths.length} image(s) to Downloads.`, "success");
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
    if (button.dataset.action === "undo") {
      if (strokes.length) strokes = strokes.slice(0, -1);
      else if (selected) { selected = null; selectionText.textContent = "No element selected"; lockedHighlight.style.display = "none"; }
      redraw();
      return;
    }
    if (button.dataset.action === "close") close();
    if (button.dataset.action === "export") void exportChanges();
  };

  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("pointermove", handlePointerHover, true);
  document.addEventListener("click", selectElement, true);
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
