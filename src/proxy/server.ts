import type { AddressInfo } from "node:net";

import Fastify, { type FastifyInstance } from "fastify";

import { forward } from "./forwarder.js";

export interface StartProxyOptions {
  upstreamUrl: string;
  port?: number;
  host?: string;
}

export interface ProxyHandle {
  port: number;
  url: string;
  server: FastifyInstance;
  close(): Promise<void>;
}

export async function startProxy(opts: StartProxyOptions): Promise<ProxyHandle> {
  const app = Fastify({ logger: false });

  const handler = async (
    req: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ): Promise<void> => {
    await forward(req, reply, opts.upstreamUrl);
  };

  app.post("/v1/messages", handler);
  app.post("/v1/chat/completions", handler);

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: "not_found" });
  });

  const host = opts.host ?? "127.0.0.1";
  await app.listen({ port: opts.port ?? 0, host });
  const address = app.server.address() as AddressInfo;

  return {
    port: address.port,
    url: `http://${host}:${address.port}`,
    server: app,
    close: () => app.close(),
  };
}
