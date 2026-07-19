import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-llm-provider-smoke-'));
process.env.KEYMEMORY_DATA_DIR = dataDir;

const { initDatabase, closeDatabase } = await import('../packages/server/dist/db/sqlite.js');
const {
  saveLLMConfig,
  verifyLLMConnection,
} = await import('../packages/server/dist/core/llm-provider.js');

function startModelServer(expectedAuthorization) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization ?? null,
    });
    response.setHeader('content-type', 'application/json');
    if ((request.headers.authorization ?? null) !== expectedAuthorization) {
      response.statusCode = 401;
      response.end(JSON.stringify({
        error: {
          type: 'invalid_authentication_error',
          message: 'invalid key',
        },
      }));
      return;
    }
    response.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        requests,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      });
    });
  });
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

initDatabase();
const cloud = await startModelServer('Bearer test-secret');
const local = await startModelServer(null);

try {
  saveLLMConfig({
    baseUrl: cloud.baseUrl,
    model: 'mock-model',
    enabled: true,
  }, 'test-secret');

  // The Web UI deliberately does not refill a saved key. An empty field must
  // therefore reuse the encrypted key when the Base URL has not changed.
  const afterReload = await verifyLLMConnection(cloud.baseUrl, '');
  assert.equal(afterReload.ok, true, 'saved API key should be reused after the page reloads');
  assert.equal(cloud.requests.at(-1)?.authorization, 'Bearer test-secret');

  // Saving unrelated settings without retyping the hidden key must not erase it.
  const savedAfterBlankResave = saveLLMConfig({
    baseUrl: cloud.baseUrl,
    model: 'mock-model',
    enabled: true,
  }, '');
  assert.equal(savedAfterBlankResave.hasApiKey, true, 'blank resave should still report that a key is stored');
  const afterResave = await verifyLLMConnection(cloud.baseUrl);
  assert.equal(afterResave.ok, true, 'saving with a blank hidden-key field should preserve the saved key');
  assert.equal(cloud.requests.at(-1)?.authorization, 'Bearer test-secret');

  // Never forward a saved cloud credential to a different host.
  const changedHost = await verifyLLMConnection(local.baseUrl, '');
  assert.equal(changedHost.ok, true, 'a changed Base URL with a blank key should behave as a keyless provider');
  assert.equal(local.requests.at(-1)?.authorization, null);

  const savedKeyless = saveLLMConfig({
    baseUrl: local.baseUrl,
    model: 'mock-model',
    enabled: true,
  }, '');
  assert.equal(savedKeyless.hasApiKey, false, 'changed keyless provider should not claim that a key is stored');
  const savedLocal = await verifyLLMConnection();
  assert.equal(savedLocal.ok, true, 'saving a changed keyless provider should clear the old host credential');
  assert.equal(local.requests.at(-1)?.authorization, null);

  console.log(JSON.stringify({
    ok: true,
    savedKeyReused: true,
    blankResavePreserved: true,
    crossHostCredentialBlocked: true,
    cloudRequests: cloud.requests.length,
    localRequests: local.requests.length,
  }, null, 2));
} finally {
  await Promise.all([stopServer(cloud.server), stopServer(local.server)]);
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
