import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const svgPath = path.join(root, "public", "icons", "icon.svg");
const out = path.join(root, "public", "icons");

const svg = await fs.readFile(svgPath);

await Promise.all([
  sharp(svg).resize(192, 192).png().toFile(path.join(out, "icon-192.png")),
  sharp(svg).resize(512, 512).png().toFile(path.join(out, "icon-512.png")),
  sharp(svg).resize(180, 180).png().toFile(path.join(out, "apple-touch-icon.png")),
  sharp(svg).resize(32, 32).png().toFile(path.join(root, "public", "favicon.png")),
]);

console.log("Icons generated.");
