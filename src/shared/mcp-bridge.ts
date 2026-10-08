import type { ElementContext } from "./export";

export const DESIGN_HELPER_BRIDGE_PORT = 7420;
export const DESIGN_HELPER_BRIDGE_URL = `http://127.0.0.1:${DESIGN_HELPER_BRIDGE_PORT}/export`;

export interface BridgeImage {
  filename: string;
  dataUrl: string;
}

export interface BridgeExportPayload {
  imagePaths: string[];
  request: string;
  elementContexts: ElementContext[];
  pageUrl: string;
  timestamp: string;
  images: BridgeImage[];
}
