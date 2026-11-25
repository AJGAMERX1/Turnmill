import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
export async function serveBuild(base = "/Turnmill/", directory = "dist") {
  const root = resolve(directory),
    types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".wasm": "application/wasm",
      ".svg": "image/svg+xml",
      ".json": "application/json",
    };
  const srv = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(
        new URL(req.url, "http://local").pathname,
      );
      if (path === base.slice(0, -1)) {
        res.writeHead(301, { location: base }).end();
        return;
      }
      const file = resolve(root, path.slice(base.length) || "index.html");
      if (!path.startsWith(base) || !file.startsWith(root + sep)) throw Error();
      const content = await readFile(file);
      res
        .writeHead(200, {
          "content-type": types[extname(file)] || "application/octet-stream",
        })
        .end(content);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  return {
    url: "http://127.0.0.1:" + srv.address().port + base,
    close: () => srv.close(),
  };
}
