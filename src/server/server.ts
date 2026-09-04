import { createServer } from "node:http";
import { handleRequest } from "./api.ts";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const server = createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
  const request = new Request(`http://${incoming.headers.host ?? `localhost:${port}`}${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers: incoming.headers as HeadersInit,
    body: incoming.method === "GET" || incoming.method === "HEAD" ? undefined : body,
  });
  const response = await handleRequest(request);
  const headers = Object.fromEntries(response.headers.entries());
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (setCookies.length > 0) headers["set-cookie"] = setCookies as never;
  outgoing.writeHead(response.status, headers);
  if (response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    outgoing.end(buffer);
  } else {
    outgoing.end();
  }
});

server.listen(port, host, () => {
  console.log(`FlowGuard AI Phase 9 shell listening on http://${host}:${port}`);
});
