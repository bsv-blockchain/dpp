import { Duplex } from 'node:stream';
import tls, { type TLSSocket } from 'node:tls';
import { gzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { createDidWebResolver } from '../src/did-web.js';

// Exercise the HTTP parser and decoder without opening a socket. The simulated
// server sends an ordinary, chunked gzip response with no Content-Length.
function serveChunkedGzip(body: Buffer) {
  return vi.spyOn(tls, 'connect').mockImplementation(() => {
    const socket = new Duplex({
      read() {},
      write(_request, _encoding, done) {
        this.push(Buffer.from('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Encoding: gzip\r\n\r\n' + body.length.toString(16) + '\r\n'));
        this.push(body);
        this.push(Buffer.from('\r\n0\r\n\r\n'));
        done();
      },
    });
    Object.assign(socket, {
      setKeepAlive: () => socket, setNoDelay: () => socket, ref: () => socket, unref: () => socket,
    });
    queueMicrotask(() => socket.emit('secureConnect'));
    return socket as unknown as TLSSocket;
  });
}

it('counts chunked wire bytes even when the decoded document fits', async () => {
  const did = 'did:web:issuer.example';
  const document = JSON.stringify({ id: did });
  const compressed = gzipSync(document);
  expect(Buffer.byteLength(document)).toBeLessThan(compressed.length - 1);
  const transport = serveChunkedGzip(compressed);
  const allowedOrigins = ['https://issuer.example'];
  try {
    await expect(createDidWebResolver({ allowedOrigins, timeoutMs: 800, maxBytes: compressed.length })(did))
      .resolves.toMatchObject({ document: { id: did } });
    await expect(createDidWebResolver({ allowedOrigins, timeoutMs: 800, maxBytes: compressed.length - 1 })(did)).rejects.toThrow('size limit');
    expect(transport).toHaveBeenCalledTimes(2);
  } finally {
    transport.mockRestore();
  }
});
