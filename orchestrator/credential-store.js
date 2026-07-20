'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const CREDENTIAL_NAMES = Object.freeze(['github', 'openai', 'gemini']);

function assertCredentialName(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!CREDENTIAL_NAMES.includes(value)) throw new TypeError(`Unsupported credential name: ${value || '<empty>'}`);
  return value;
}

class CredentialStore {
  constructor({ safeStorage, filePath, fsPromises = fsp, fsSync = fs } = {}) {
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') {
      throw new TypeError('Electron safeStorage implementation is required.');
    }
    if (!filePath) throw new TypeError('Credential file path is required.');
    this.safeStorage = safeStorage;
    this.filePath = path.resolve(String(filePath));
    this.fs = fsPromises;
    this.fsSync = fsSync;
    this.writeChain = Promise.resolve();
  }

  isAvailable() {
    try { return Boolean(this.safeStorage.isEncryptionAvailable()); }
    catch { return false; }
  }

  assertAvailable() {
    if (!this.isAvailable()) throw new Error('Secure operating-system credential storage is unavailable.');
  }

  async readEnvelope() {
    try {
      const raw = await this.fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Number(parsed?.version) !== 1 || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
        throw new Error('Credential store format is invalid.');
      }
      return { version: 1, entries: { ...parsed.entries } };
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, entries: {} };
      throw error;
    }
  }

  async writeEnvelope(envelope) {
    await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify({ version: 1, entries: envelope.entries }, null, 2)}\n`;
    await this.fs.writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
    try { await this.fs.chmod(tempPath, 0o600); } catch {}
    await this.fs.rename(tempPath, this.filePath);
  }

  mutate(mutator) {
    const operation = this.writeChain.catch(() => {}).then(async () => {
      this.assertAvailable();
      const envelope = await this.readEnvelope();
      await mutator(envelope.entries);
      await this.writeEnvelope(envelope);
    });
    this.writeChain = operation;
    return operation;
  }

  save(name, secret) {
    const credentialName = assertCredentialName(name);
    const value = String(secret || '').trim();
    if (!value) throw new TypeError(`Credential ${credentialName} cannot be empty.`);
    return this.mutate(async (entries) => {
      const encrypted = this.safeStorage.encryptString(value);
      if (!Buffer.isBuffer(encrypted)) throw new Error('Credential encryption did not return bytes.');
      entries[credentialName] = {
        encoding: 'base64',
        encrypted: encrypted.toString('base64'),
        updatedAt: new Date().toISOString()
      };
    });
  }

  async load(name) {
    const credentialName = assertCredentialName(name);
    await this.writeChain.catch(() => {});
    this.assertAvailable();
    const envelope = await this.readEnvelope();
    const entry = envelope.entries[credentialName];
    if (!entry) return '';
    if (entry.encoding !== 'base64' || !entry.encrypted) throw new Error(`Credential ${credentialName} is corrupt.`);
    return this.safeStorage.decryptString(Buffer.from(String(entry.encrypted), 'base64'));
  }

  remove(name) {
    const credentialName = assertCredentialName(name);
    return this.mutate(async (entries) => {
      delete entries[credentialName];
    });
  }

  async metadata() {
    await this.writeChain.catch(() => {});
    const available = this.isAvailable();
    const configured = Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, false]));
    if (!available) return { available, configured };
    const envelope = await this.readEnvelope();
    for (const name of CREDENTIAL_NAMES) configured[name] = Boolean(envelope.entries[name]?.encrypted);
    return { available, configured };
  }
}

module.exports = {
  CREDENTIAL_NAMES,
  CredentialStore,
  assertCredentialName
};
