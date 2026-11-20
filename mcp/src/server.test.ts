import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./server.ts";

const TOKEN = "t".repeat(40);
let server: Server;
let base: string;

before(async () => {
  server = createApp(TOKEN).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const rpc = (body: unknown, token?: string) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};

test("rejects missing and wrong tokens", async () => {
  assert.equal((await rpc(init)).status, 401);
  assert.equal((await rpc(init, "x".repeat(40))).status, 401);
});

test("lists and calls ping with the right token", async () => {
  assert.equal((await rpc(init, TOKEN)).status, 200);
  const list = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, TOKEN)).json();
  assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ["ping"]);
  const call = await (
    await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ping", arguments: {} } }, TOKEN)
  ).json();
  assert.equal(JSON.parse(call.result.content[0].text).reply, "pong");
});

test("rejects short tokens at startup", () => {
  assert.throws(() => createApp("short"));
});
