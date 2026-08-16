import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const outdir = "dist";

await rm(outdir, { force: true, recursive: true });
await mkdir(outdir, { recursive: true });

await Promise.all([
  build({
    bundle: true,
    entryPoints: ["src/background.ts"],
    format: "esm",
    outfile: `${outdir}/background.js`,
    platform: "browser",
    target: "chrome120",
  }),
  build({
    bundle: true,
    entryPoints: ["src/content/overlay.ts"],
    format: "iife",
    globalName: "DesignHelper",
    outfile: `${outdir}/content.js`,
    platform: "browser",
    target: "chrome120",
  }),
  cp("src/manifest.json", `${outdir}/manifest.json`),
  cp("src/icons", `${outdir}/icons`, { recursive: true }),
]);
