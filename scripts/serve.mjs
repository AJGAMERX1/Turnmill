import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const port = 4179,
  url = "http://127.0.0.1:" + port + "/";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
function open() {
  console.log("Turnmill is ready at " + url);
  if (!process.argv.includes("--open")) return;
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const args =
    platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
try {
  await stat(resolve(root, "index.html"));
} catch {
  console.error(
    "The prebuilt app is missing. Run npm install and npm run build in Turnmill.",
  );
  process.exit(1);
}
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const route = decodeURIComponent(new URL(req.url, url).pathname),
      path = resolve(root, "." + (route === "/" ? "/index.html" : route));
    if (!path.startsWith(root + sep)) {
      res.writeHead(404).end();
      return;
    }
    const data = await readFile(path);
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
      "Cache-Control": path.includes(sep + "assets" + sep)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404).end("File not found");
  }
});
server.on("error", async (err) => {
  if (err.code === "EADDRINUSE") {
    try {
      const res = await fetch(url);
      if (res.ok && (await res.text()).includes("<title>Turnmill")) {
        open();
        return;
      }
    } catch {}
    console.error(
      "Port 4179 is in use. Close its other application, then launch Turnmill again.",
    );
  } else console.error(err.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", open);
