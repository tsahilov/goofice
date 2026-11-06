// Только локальный предпросмотр статических файлов, не сервер приложения.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] ?? 4173);
const files = new Map([
  ["/visual-effects.mjs", ["visual-effects.mjs", "text/javascript; charset=utf-8"]],
  ["/firebase-init.mjs", ["firebase-init.mjs", "text/javascript; charset=utf-8"]],
  ["/cloud-store.mjs", ["cloud-store.mjs", "text/javascript; charset=utf-8"]],
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/data.js", ["data.js", "text/javascript; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/assets/fonts/MedeoSansVariable.woff2", ["assets/fonts/MedeoSansVariable.woff2", "font/woff2"]],
  ["/assets/fonts/MedeoSansVariable-Italic.woff2", ["assets/fonts/MedeoSansVariable-Italic.woff2", "font/woff2"]],
]);
const server = http.createServer((request, response) => {
  const file = files.get(new URL(request.url, "http://localhost").pathname);
  if (!file || !["GET", "HEAD"].includes(request.method)) {
    response.writeHead(404).end("Not found");
    return;
  }
  fs.readFile(path.join(root, file[0]), (error, content) => {
    if (error) { response.writeHead(500).end("Unable to read file"); return; }
    response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : content);
  });
});
server.on("error", (error) => {
  console.error(`Не удалось запустить предпросмотр: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`Локальный предпросмотр: http://127.0.0.1:${port}`));
