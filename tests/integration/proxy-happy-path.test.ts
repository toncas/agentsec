import type { AddressInfo } from "node:net";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startProxy } from "../../src/proxy/server";

interface CapturedRequest {
  path: string;
  method: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface UpstreamHandle {
  url: string;
  close(): Promise<void>;
  captured: CapturedRequest[];
  setHandler(handler: (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => unknown | Promise<unknown>): void;
}

async function startFakeUpstream(): Promise<UpstreamHandle> {
  const app: FastifyInstance = Fastify({ logger: false });
  const captured: CapturedRequest[] = [];
  let handler: (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => unknown | Promise<unknown> = async () => ({
    id: "msg_test",
    content: [{ type: "text", text: "ok" }],
  });

  app.post("/v1/messages", async (req, reply) => {
    captured.push({
      path: req.url,
      method: req.method,
      body: req.body,
      headers: { ...req.headers },
    });
    return handler(req, reply);
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => app.close(),
    captured,
    setHandler: (h) => {
      handler = h;
    },
  };
}

describe("proxy happy-path", () => {
  let upstream: UpstreamHandle;
  let proxy: Awaited<ReturnType<typeof startProxy>>;

  beforeEach(async () => {
    upstream = await startFakeUpstream();
    proxy = await startProxy({ upstreamUrl: upstream.url, port: 0 });
  });

  afterEach(async () => {
    await proxy.close();
    await upstream.close();
  });

  it("forwards POST /v1/messages body unchanged to upstream", async () => {
    const body = { system: "You are a helpful assistant", messages: [{ role: "user", content: "hi" }] };

    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    expect(upstream.captured).toHaveLength(1);
    expect(upstream.captured[0]!.path).toBe("/v1/messages");
    expect(upstream.captured[0]!.body).toEqual(body);
  });

  it("returns upstream response body unchanged to caller", async () => {
    upstream.setHandler(async () => ({ id: "msg_abc", content: [{ type: "text", text: "hello-world" }] }));

    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system: "s", messages: [] }),
    });

    const json = (await res.json()) as { id: string; content: Array<{ text: string }> };
    expect(json.id).toBe("msg_abc");
    expect(json.content[0]!.text).toBe("hello-world");
  });

  it("streams SSE chunks in order without buffering full body", async () => {
    upstream.setHandler(async (_req, reply) => {
      reply.raw.setHeader("content-type", "text/event-stream");
      reply.raw.write('data: {"type":"content_block_start"}\n\n');
      reply.raw.write('data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n');
      reply.raw.write('data: {"type":"message_stop"}\n\n');
      reply.raw.end();
      return reply;
    });

    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system: "s", messages: [] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }

    const startIdx = received.indexOf("content_block_start");
    const deltaIdx = received.indexOf("content_block_delta");
    const stopIdx = received.indexOf("message_stop");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(deltaIdx).toBeGreaterThan(startIdx);
    expect(stopIdx).toBeGreaterThan(deltaIdx);
  });

  it("survives cold → warm → warm (two sequential requests on same proxy)", async () => {
    const body = { system: "s", messages: [{ role: "user", content: "x" }] };

    const res1 = await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res1.status).toBe(200);
    await res1.text();

    const res2 = await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res2.status).toBe(200);
    await res2.text();

    expect(upstream.captured).toHaveLength(2);
    expect(upstream.captured[0]!.body).toEqual(body);
    expect(upstream.captured[1]!.body).toEqual(body);
  });
});
