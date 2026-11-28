import { createServer } from 'node:http';

const [, , service, port] = process.argv;
let startedUploads = 0;
let abortedUploads = 0;

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://upstream');
  const body = { service, target: request.url, method: request.method };
  if (request.method === 'POST' && url.pathname === '/api/v1/matches') {
    let receivedBytes = 0;
    let firstChunk = true;
    try {
      for await (const chunk of request) {
        if (firstChunk) startedUploads++;
        firstChunk = false;
        receivedBytes += chunk.length;
      }
    } catch {
      if (request.destroyed) abortedUploads++;
      return;
    }
    response.statusCode = 202;
    body.receivedBytes = receivedBytes;
  }
  if (url.searchParams.has('uploadStatus')) Object.assign(body, { startedUploads, abortedUploads });
  if (url.searchParams.has('stall')) return;
  if (url.searchParams.has('bytes')) {
    response.setHeader('Content-Type', 'application/octet-stream');
    response.end(Buffer.from([0x00, 0x29, 0xfe, 0xff]));
    return;
  }
  if (url.searchParams.has('typed')) {
    const status = url.searchParams.get('typed') === 'unavailable' ? 503 : 422;
    response.writeHead(status, { 'Content-Type': 'application/json', 'X-Request-ID': 'fixture-upstream-id' });
    response.end(JSON.stringify({ error: { code: 'FIXTURE_ERROR', message: 'Typed upstream error' }, requestId: 'fixture-upstream-id' }));
    return;
  }
  if (url.searchParams.has('echoHeaders')) {
    body.headers = {
      origin: request.headers.origin ?? null,
      forwarded: request.headers.forwarded ?? null,
      realIp: request.headers['x-real-ip'],
      forwardedFor: request.headers['x-forwarded-for'],
      requestId: request.headers['x-request-id'],
      cookie: request.headers.cookie ?? null,
    };
  }
  if (service === 'auth') response.setHeader('Set-Cookie', 'fixture_auth=synthetic; HttpOnly; SameSite=Strict; Path=/');
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}).listen(Number(port), '0.0.0.0');
