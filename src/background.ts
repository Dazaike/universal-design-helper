import { DESIGN_HELPER_BRIDGE_URL, type BridgeExportPayload } from "./shared/mcp-bridge";

type CaptureMessage = { type: "capture-visible-tab" };
type DownloadImageMessage = { type: "download-image"; imageUrl: string; imageFilename: string };
type PostHandoffMessage = { type: "post-design-handoff"; payload: BridgeExportPayload };
type Message = CaptureMessage | DownloadImageMessage | PostHandoffMessage;

async function setActionError(tabId: number, message: string): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b42318" });
  await chrome.action.setTitle({ tabId, title: message });
}

async function clearActionError(tabId: number): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setTitle({ tabId, title: "Annotate this page" });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await clearActionError(tab.id);
  } catch {
    await setActionError(tab.id, "Design Helper cannot run on this page.");
  }
});

async function waitForDownloadFilename(id: number, targetFilename: string): Promise<string> {
  const maxWaitMs = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const [download] = await chrome.downloads.search({ id });
    if (download) {
      if (download.error) {
        throw new Error(`Download interrupted: ${download.error}`);
      }
      if (download.filename && download.filename.trim().length > 0) {
        return download.filename;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const [finalCheck] = await chrome.downloads.search({ id });
  if (finalCheck?.filename) return finalCheck.filename;
  return `~/Downloads/design-helper/${targetFilename}`;
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type === "capture-visible-tab") {
    const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    void chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 95 })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === "download-image") {
    const url = message.imageUrl;
    const filename = message.imageFilename;
    void chrome.downloads.download({
      url,
      filename: `design-helper/${filename}`,
      conflictAction: "uniquify",
      saveAs: false,
    }).then(async (id) => {
      const savedPath = await waitForDownloadFilename(id, filename);
      sendResponse({ ok: true, id, filename: savedPath });
    }).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === "post-design-handoff") {
    console.log("[Design Helper] posting handoff to bridge:", DESIGN_HELPER_BRIDGE_URL, message.payload.pageUrl);
    void fetch(DESIGN_HELPER_BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Bridge responded with status ${response.status}`);
      console.log("[Design Helper] bridge accepted handoff.");
      sendResponse({ ok: true });
    }).catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Design Helper] bridge POST failed:", errorMessage);
      sendResponse({ ok: false, error: errorMessage });
    });
    return true;
  }
  return false;
});
