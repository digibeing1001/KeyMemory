import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';

let app: FastifyInstance;
let closeDatabase: () => void;

before(async () => {
  process.env.KEYMEMORY_DB_PATH = ':memory:';
  const database = await import('../../db/sqlite.js');
  const { registerRoutes } = await import('../../api/rest.js');

  database.initDatabase();
  closeDatabase = database.closeDatabase;
  app = Fastify({ logger: false });
  registerRoutes(app);
  await app.ready();
});

after(async () => {
  await app.close();
  closeDatabase();
  delete process.env.KEYMEMORY_DB_PATH;
});

test('auth status guides a new installation to registration', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/auth/status' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { hasUsers: false });
});

test('first registration validates input, normalizes email, and can log in', async () => {
  const weakPassword = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'Test User', email: 'test@example.com', password: 'short' },
  });
  assert.equal(weakPassword.statusCode, 400);

  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: '  Test User  ',
      email: '  Test.User@Example.COM  ',
      password: 'correct-horse-battery-staple',
    },
  });

  assert.equal(registration.statusCode, 201);
  const registered = registration.json();
  assert.equal(registered.user.name, 'Test User');
  assert.equal(registered.user.email, 'test.user@example.com');
  assert.equal(registered.user.role, 'boss');
  assert.equal(registered.user.isMainAccount, true);
  assert.ok(registered.token);

  const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
  assert.deepEqual(status.json(), { hasUsers: true });

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'TEST.USER@EXAMPLE.COM', password: 'correct-horse-battery-staple' },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().user.id, registered.user.id);

  const loginToken = login.json().token as string;
  const logout = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { authorization: `Bearer ${loginToken}` },
  });
  assert.equal(logout.statusCode, 200);
  assert.deepEqual(logout.json(), { success: true });

  const revokedSession = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${loginToken}` },
  });
  assert.equal(revokedSession.statusCode, 401);

  const wrongPassword = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'test.user@example.com', password: 'wrong-password' },
  });
  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(wrongPassword.json().error, 'Invalid email or password');
});
