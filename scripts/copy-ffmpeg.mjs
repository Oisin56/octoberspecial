// Copies the browser ffmpeg build into /public so the reel builder loads it from our own site.
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/ffmpeg", { recursive: true });
cpSync("node_modules/@ffmpeg/ffmpeg/dist/esm", "public/ffmpeg", { recursive: true });
cpSync("node_modules/@ffmpeg/core/dist/esm", "public/ffmpeg/core", { recursive: true });
console.log("ffmpeg copied to public/ffmpeg");
