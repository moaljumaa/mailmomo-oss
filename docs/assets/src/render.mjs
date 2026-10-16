// Regenerate README images: node docs/assets/src/render.mjs [name ...]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(here, "../images");
mkdirSync(out, { recursive: true });
const require = createRequire(join(root, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const lucide = require("lucide-react");
const { chromium } = require("playwright");

const fontUrl = pathToFileURL(join(root, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")).href;
const css = readFileSync(join(here, "base.css"), "utf8").replace("__FONT__", fontUrl);

// <ic n="Inbox" s="15" c="cls" /> -> lucide svg
function icons(html) {
  return html.replace(/<ic\s+([^>]*?)\/>/g, (_, a) => {
    const at = Object.fromEntries([...a.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const Cmp = lucide[at.n];
    if (!Cmp) throw new Error("unknown icon " + at.n);
    return renderToStaticMarkup(React.createElement(Cmp, { size: +(at.s || 15), strokeWidth: +(at.w || 1.75), className: "ic " + (at.c || ""), style: at.st ? Object.fromEntries(at.st.split(";").map((x) => x.split(":")).map(([k, v]) => [k.replace(/-(\w)/g, (_, c) => c.toUpperCase()), v])) : undefined }));
  });
}

const jobs = [
  ["hero", 1600, 1000], ["hero-dark", 1600, 1000], ["ai-assistant", 1600, 1000], ["multi-account", 1600, 1000],
  ["mcp", 1600, 1000], ["command-palette", 1600, 1000], ["social-preview", 1280, 640],
];
const only = process.argv.slice(2);
const browser = await chromium.launch();
for (const [name, w, h] of jobs) {
  if (only.length && !only.includes(name)) continue;
  const srcName = name === "hero-dark" ? "hero" : name;
  let html = readFileSync(join(here, srcName + ".html"), "utf8");
  if (name === "hero-dark") html = html.replace('<html lang="en">', '<html lang="en" data-theme="dark">');
  html = html.replace(/<!--include (\S+)-->/g, (_, f) => readFileSync(join(here, f), "utf8"));
  html = icons(html).replace("</head>", `<style>${css}</style></head>`);
  const full = join(here, ".tmp-" + name + ".html");
  writeFileSync(full, html);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(full).href);
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot();
  const sharp = require("sharp");
  await sharp(buf).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toFile(join(out, name + ".png"));
  await page.close();
  console.log(name, Math.round(statSync(join(out, name + ".png")).size / 1024) + "KB");
}
await browser.close();
