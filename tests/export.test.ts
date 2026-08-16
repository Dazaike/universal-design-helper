// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  bounded,
  computeCropBox,
  cssLocator,
  elementContextFrom,
  formatFilenameTimestamp,
  renderHandoffText,
} from "../src/shared/export";

describe("element context helpers", () => {
  it("builds stable ID and structural CSS locators", () => {
    document.body.innerHTML = '<main id="app"><section><button class="save">Save</button></section></main>';
    const main = document.querySelector("main")!;
    const button = document.querySelector("button")!;
    expect(cssLocator(main)).toBe("#app");
    expect(cssLocator(button)).toBe("#app > section:nth-of-type(1) > button:nth-of-type(1)");
  });

  it("bounds serialized text and outer HTML with a truncation marker", () => {
    document.body.innerHTML = `<button data-note="visible">${"a".repeat(2_100)}</button>`;
    const context = elementContextFrom(document.querySelector("button")!, "https://example.test/page");
    expect(context.visibleText).toHaveLength(2_011);
    expect(context.visibleText.endsWith("[truncated]")).toBe(true);
    expect(bounded("a".repeat(20_001), 20_000).endsWith("[truncated]")).toBe(true);
    expect(context.attributes).toEqual({ "data-note": "visible" });
  });
});

describe("handoff serialization", () => {
  it("renders exact handoff text with two spaces after image path and element context 2 lines below request", () => {
    const text = renderHandoffText(
      ["/home/daz/Downloads/design-helper/capture.png", "/home/daz/Downloads/design-helper/attached-1.png"],
      "Make the button orange",
      {
        pageUrl: "https://example.test",
        rect: { x: 1, y: 2, width: 3, height: 4 },
        tagName: "button", id: null, classList: [], attributes: {}, visibleText: "Save",
        cssLocator: "button:nth-of-type(1)", outerHtml: "<button>Save</button>", computedStyle: {},
      }
    );
    const expectedStart = '@"/home/daz/Downloads/design-helper/capture.png" @"/home/daz/Downloads/design-helper/attached-1.png"  Make the button orange\n\n{\n  "pageUrl":';
    expect(text.startsWith(expectedStart)).toBe(true);
  });

  it("renders handoff text with element context 2 lines below image path when no change request is provided", () => {
    const text = renderHandoffText(
      "/home/daz/Downloads/design-helper/capture.png",
      "",
      {
        pageUrl: "https://example.test",
        rect: { x: 1, y: 2, width: 3, height: 4 },
        tagName: "button", id: null, classList: [], attributes: {}, visibleText: "Save",
        cssLocator: "button:nth-of-type(1)", outerHtml: "<button>Save</button>", computedStyle: {},
      }
    );
    expect(text.startsWith('@"/home/daz/Downloads/design-helper/capture.png"\n\n{\n  "pageUrl":')).toBe(true);
  });

  it("computes bounded crop box with padding", () => {
    const crop = computeCropBox({
      request: "test",
      pageUrl: "https://example.test",
      timestamp: new Date(),
      viewport: { width: 1000, height: 800, devicePixelRatio: 1 },
      strokes: [{ points: [{ x: 100, y: 150 }, { x: 200, y: 250 }] }],
      elementContext: null,
    });
    expect(crop).toEqual({ x: 70, y: 120, width: 160, height: 160 });
  });

  it("formats portable filenames", () => {
    expect(formatFilenameTimestamp(new Date("2026-08-12T12:34:56.789Z"))).toBe("2026-08-12T12-34-56-789Z");
  });
});
