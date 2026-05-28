import { pipeline } from "node:stream/promises";

import type { FastifyReply, FastifyRequest } from "fastify";
import { request as undiciRequest } from "undici";

import { UpstreamError } from "../errors.js";

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function sanitizeRequestHeaders(
  headers: FastifyRequest["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_REQUEST_HEADERS.has(lower)) continue;
    out[lower] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

function applyResponseHeaders(
  reply: FastifyReply,
  headers: Record<string, string | string[] | undefined>,
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    reply.raw.setHeader(name, value as string | string[]);
  }
}

export async function forward(
  req: FastifyRequest,
  reply: FastifyReply,
  upstreamUrl: string,
): Promise<void> {
  const url = new URL(req.url, upstreamUrl).toString();
  const headers = sanitizeRequestHeaders(req.headers);
  const body =
    req.body === undefined || req.body === null
      ? undefined
      : JSON.stringify(req.body);

  if (body !== undefined && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  let upstreamResponse;
  try {
    upstreamResponse = await undiciRequest(url, {
      method: req.method as "POST",
      headers,
      body,
    });
  } catch (err) {
    throw new UpstreamError(
      `Upstream request failed: ${(err as Error).message}`,
    );
  }

  reply.raw.statusCode = upstreamResponse.statusCode;
  applyResponseHeaders(reply, upstreamResponse.headers);
  reply.hijack();

  try {
    await pipeline(upstreamResponse.body, reply.raw);
  } catch (err) {
    if (!reply.raw.writableEnded) reply.raw.end();
    throw new UpstreamError(
      `Upstream stream failed: ${(err as Error).message}`,
    );
  }
}
