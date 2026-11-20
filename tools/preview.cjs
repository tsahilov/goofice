// Только локальный предпросмотр статических файлов, не сервер приложения.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] ?? 4173);
const files = new Map([
  ["/participants.mjs", ["participants.mjs", "text/javascript; charset=utf-8"]],
  ["/firebase-config.mjs", ["firebase-config.mjs", "text/javascript; charset=utf-8"]],
  ["/visual-effects.mjs", ["visual-effects.mjs", "text/javascript; charset=utf-8"]],
  ["/firebase-init.mjs", ["firebase-init.mjs", "text/javascript; charset=utf-8"]],
  ["/cloud-store.mjs", ["cloud-store.mjs", "text/javascript; charset=utf-8"]],
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/data.js", ["data.js", "text/javascript; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/archive/archive.css", ["archive/archive.css", "text/css; charset=utf-8"]],
  ["/archive/entries.mjs", ["archive/entries.mjs", "text/javascript; charset=utf-8"]],
  ["/archive/list.mjs", ["archive/list.mjs", "text/javascript; charset=utf-8"]],
  ["/assets/fonts/MedeoSansVariable.woff2", ["assets/fonts/MedeoSansVariable.woff2", "font/woff2"]],
  ["/assets/fonts/MedeoSansVariable-Italic.woff2", ["assets/fonts/MedeoSansVariable-Italic.woff2", "font/woff2"]],
]);
const archiveTypes = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
};
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const route = pathname === "/goofice" ? "/" : pathname.replace(/^\/goofice(?=\/)/, "");
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(404).end("Not found");
    return;
  }
  if (pathname === "/goofice" || /^\/archive\/\d{4}-\d{2}-\d{2}$/.test(route)) {
    response.writeHead(308, { Location: pathname + "/" }).end();
    return;
  }
  let file = files.get(route);
  const article = /^\/archive\/\d{4}-\d{2}-\d{2}\/(?:(index\.html|[\w-]+\.(?:png|jpe?g|webp|avif)))?$/.exec(route);
  if (article) {
    const source = route.slice(1) + (article[1] ? "" : "index.html");
    file = [source, archiveTypes[path.extname(source)]];
  }
  if (!file) {
    response.writeHead(404).end("Not found");
    return;
  }
  fs.readFile(path.join(root, file[0]), (error, content) => {
    if (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Unable to read file"); return; }
    response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : content);
  });
});
server.on("error", (error) => {
  console.error(`Не удалось запустить предпросмотр: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`Локальный предпросмотр: http://127.0.0.1:${server.address().port}`));
