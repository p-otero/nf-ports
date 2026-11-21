import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const preload = pathToFileURL(join(import.meta.dir, "..", "preload", "localhost-dns.mjs")).href;
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.end("lumen");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new TypeError("server has no TCP address");
  port = address.port;
});

afterAll(() => {
  server.close();
});

class NodeRunError extends Error {
  override readonly name = "NodeRunError";
}

const runNode = async (source: string): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(
      "node",
      ["--import", preload, "--input-type=module", "-e", source],
      { encoding: "utf8", timeout: 15_000 },
      (error, stdout, stderr) => {
        if (error) reject(new NodeRunError(error.message, { cause: error }));
        else resolve({ stdout, stderr });
      },
    );
  });

describe("localhost-dns preload", () => {
  test("lets Node fetch reach a *.localhost name on loopback", async () => {
    const result = await runNode(
      `const r = await fetch("http://feat-alpha-search.api.lumen.localhost:${port}/"); console.log(await r.text());`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("lumen");
  });

  test("answers dns.promises.lookup and leaves other names alone", async () => {
    const result = await runNode(
      `import dns from "node:dns"; const local = await dns.promises.lookup("x.lumen.localhost", { all: true }); const plain = await dns.promises.lookup("localhost"); console.log(JSON.stringify(local), typeof plain.address);`,
    );
    expect(result.stdout.trim()).toBe('[{"address":"127.0.0.1","family":4}] string');
  });
});
