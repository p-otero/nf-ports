import { createServer } from "node:http";
import { execFileSync } from "node:child_process";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();

createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  if (req.url === "/api/greeting") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: "hello from lumen api", branch, port }));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
}).listen(port, host, () => {
  console.log(`lumen api on http://${host}:${port} (branch ${branch})`);
});
