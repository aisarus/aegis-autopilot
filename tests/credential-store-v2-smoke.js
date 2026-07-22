'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { CredentialStore } = require('../orchestrator/credential-store');

(async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aegis-credentials-'));
  const filePath = path.join(tempDir, 'credentials.json');
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      return Buffer.from(`encrypted:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8');
    },
    decryptString(buffer) {
      const payload = buffer.toString('utf8');
      if (!payload.startsWith('encrypted:')) throw new Error('Invalid encrypted payload');
      return Buffer.from(payload.slice('encrypted:'.length), 'base64').toString('utf8');
    }
  };

  const store = new CredentialStore({ safeStorage: fakeSafeStorage, filePath });
  await Promise.all([
    store.save('github', 'github-secret-value'),
    store.save('openai', 'openai-secret-value'),
    store.save('gemini', 'gemini-secret-value')
  ]);

  const raw = await fsp.readFile(filePath, 'utf8');
  for (const secret of ['github-secret-value', 'openai-secret-value', 'gemini-secret-value']) {
    assert.equal(raw.includes(secret), false, `Plaintext secret reached disk: ${secret}`);
  }

  assert.equal(await store.load('github'), 'github-secret-value');
  assert.equal(await store.load('openai'), 'openai-secret-value');
  assert.equal(await store.load('gemini'), 'gemini-secret-value');

  const metadata = await store.metadata();
  assert.deepEqual(metadata, {
    available: true,
    configured: { github: true, openai: true, gemini: true }
  });
  assert.equal(JSON.stringify(metadata).includes('secret-value'), false);

  await store.remove('openai');
  assert.equal(await store.load('openai'), '');
  assert.deepEqual((await store.metadata()).configured, { github: true, openai: false, gemini: true });
  assert.equal(fs.existsSync(`${filePath}.tmp`), false, 'Atomic temp file was left behind.');

  const unavailable = new CredentialStore({
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => ''
    },
    filePath: path.join(tempDir, 'unavailable.json')
  });
  await assert.rejects(() => unavailable.save('github', 'never-write-this'), /unavailable/);
  assert.deepEqual(await unavailable.metadata(), {
    available: false,
    configured: { github: false, openai: false, gemini: false }
  });
  assert.throws(() => store.save('unknown', 'x'), /Unsupported credential name/);
  assert.throws(() => store.save('github', ''), /cannot be empty/);

  await fsp.rm(tempDir, { recursive: true, force: true });
  console.log('Encrypted credential store v2 smoke test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
