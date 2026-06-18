import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve("dist");
const indexHtml = resolve(distDir, "index.html");
const notFoundHtml = resolve(distDir, "404.html");
const noJekyll = resolve(distDir, ".nojekyll");

if (!existsSync(indexHtml)) {
  throw new Error(`Missing build output: ${indexHtml}`);
}

copyFileSync(indexHtml, notFoundHtml);
writeFileSync(noJekyll, "", "utf8");

console.log("Prepared GitHub Pages artifacts: 404.html, .nojekyll");
