#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { renderHandoffText } from "../shared/export";
import { DESIGN_HELPER_BRIDGE_PORT, type BridgeExportPayload } from "../shared/mcp-bridge";

interface PendingHandoff {
  payload: BridgeExportPayload;
  consumed: boolean;
}

let pending: PendingHandoff | null = null;

function startBridgeServer(): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || req.url !== "/export") {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", (error: Error) => {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: error.message }));
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as BridgeExportPayload;
        pending = { payload, consumed: false };
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(
          JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })
        );
      }
    });
  });
  server.on("error", (error: Error) => {
    console.error("Design Helper bridge server error (port may be in use):", error.message);
  });
  server.listen(DESIGN_HELPER_BRIDGE_PORT, "127.0.0.1");
}

function dataUrlToImageContent(dataUrl: string): { type: "image"; data: string; mimeType: string } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (match) return { type: "image", data: match[2], mimeType: match[1] };
  return { type: "image", data: dataUrl, mimeType: "image/png" };
}

function buildServer(): McpServer {
  const mcp = new McpServer({ name: "universal-design-helper", version: "0.1.1" });

  mcp.registerTool(
    "get_pending_design_request",
    {
      title: "Get pending design request",
      description:
        "Returns the most recent design change request submitted from the Universal Design Helper browser extension: the annotated screenshot, any attached images, the change request text, target page URL, and selected DOM element context (a single object, or an array when multiple elements were selected). Consumes the request by default so repeated calls do not return stale data; pass peek=true to inspect without consuming.",
      inputSchema: {
        peek: z.boolean().optional().describe("If true, do not mark the request as consumed."),
      },
    },
    async ({ peek }) => {
      if (!pending || pending.consumed) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No design change request is pending. Open the target webpage, click the Universal Design Helper toolbar, describe or annotate the change, then click Export.",
            },
          ],
        };
      }
      const { payload } = pending;
      if (!peek) pending.consumed = true;
      const text = renderHandoffText(payload.imagePaths, payload.request, payload.elementContexts);
      const header = `Page: ${payload.pageUrl}\nCaptured: ${payload.timestamp}\n\n`;
      return {
        content: [
          { type: "text" as const, text: header + text },
          ...payload.images.map((image) => dataUrlToImageContent(image.dataUrl)),
        ],
      };
    }
  );

  return mcp;
}

async function main(): Promise<void> {
  startBridgeServer();
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
}

void main().catch((error: unknown) => {
  console.error("Fatal error starting Universal Design Helper MCP server:", error);
  process.exit(1);
});
