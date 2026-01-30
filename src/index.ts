import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const app = express();
const PORT = process.env.PORT || 3000;
const RENDER_OUTPUT_DIR = process.env.RENDER_OUTPUT_DIR || "./renders";

if (!fs.existsSync(RENDER_OUTPUT_DIR)) {
  fs.mkdirSync(RENDER_OUTPUT_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/renders", express.static(RENDER_OUTPUT_DIR));

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/render", async (req, res) => {
  const renderId = uuidv4();
  const tempDir = path.join(RENDER_OUTPUT_DIR, `temp-${renderId}`);
  
  try {
    const { code, compositionId = "DynamicComponent", durationInFrames = 150, fps = 30, width = 1920, height = 1080 } = req.body;
    if (!code) return res.status(400).json({ error: "Missing code" });

    console.log(`[${renderId}] Starting render...`);
    fs.mkdirSync(tempDir, { recursive: true });

    const entryFile = path.join(tempDir, "index.tsx");
    const componentFile = path.join(tempDir, "Component.tsx");

    fs.writeFileSync(componentFile, code);
    fs.writeFileSync(entryFile, `
import { registerRoot, Composition } from "remotion";
import React from "react";
import DynamicComponent from "./Component";

const Root: React.FC = () => (
  <Composition id="${compositionId}" component={DynamicComponent} durationInFrames={${durationInFrames}} fps={${fps}} width={${width}} height={${height}} />
);
registerRoot(Root);
`);

    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: `render-${renderId}`, version: "1.0.0", dependencies: { remotion: "^4.0.0", react: "^18.2.0", "react-dom": "^18.2.0" } }));

    console.log(`[${renderId}] Bundling...`);
    const bundleLocation = await bundle({ entryPoint: entryFile, webpackOverride: (config) => config });

    console.log(`[${renderId}] Selecting composition...`);
    const composition = await selectComposition({ serveUrl: bundleLocation, id: compositionId });

    const outputPath = path.join(RENDER_OUTPUT_DIR, `${renderId}.mp4`);
    console.log(`[${renderId}] Rendering...`);

    await renderMedia({ composition, serveUrl: bundleLocation, codec: "h264", outputLocation: outputPath, chromiumOptions: { enableMultiProcessOnLinux: true } });

    console.log(`[${renderId}] Complete!`);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    fs.rmSync(tempDir, { recursive: true, force: true });

    res.json({ success: true, videoUrl: `${baseUrl}/renders/${renderId}.mp4`, renderId });
  } catch (error) {
    console.error(`[${renderId}] Failed:`, error);
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Render failed" });
  }
});

app.listen(PORT, () => console.log(`🎬 Render Server running on port ${PORT}`));
