// Encryption at rest for home-access details (C2.3): AES-GCM-256 through WebCrypto, which both runtimes provide.
// The owner's id is bound in as additional data, so a ciphertext can't be moved to another customer's row.
import { config } from './config.mjs';
import { requireThat } from './validate.mjs';

const keys = new Map(); // base64 key text → CryptoKey
async function importKey(text) {
  if (!keys.has(text)) {
    const raw = Uint8Array.from(atob(text), c => c.charCodeAt(0));
    requireThat(raw.length === 32, 'The home-access vault key is not 32 bytes.', 503, 'vault_unconfigured');
    keys.set(text, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  return keys.get(text);
}
const toBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const additional = owner => new TextEncoder().encode('home_access:' + owner);

export function requireVault() {
  requireThat(config.vaultKey, 'Home-access details are unavailable: the vault key is not configured.', 503, 'vault_unconfigured');
}
export async function encrypt(owner, plaintext) {
  requireVault();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:additional(owner) },
    await importKey(config.vaultKey), new TextEncoder().encode(plaintext));
  return { secret_enc:toBase64(sealed), iv:toBase64(iv) };
}
// Returns { plaintext, rotated }: rotated is true when only the previous key could open it (the caller re-encrypts).
export async function decrypt(owner, secret_enc, iv) {
  requireVault();
  for (const [text, rotated] of [[config.vaultKey, false], [config.vaultKeyPrevious, true]]) {
    if (!text) continue;
    try {
      const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:fromBase64(iv), additionalData:additional(owner) },
        await importKey(text), fromBase64(secret_enc));
      return { plaintext:new TextDecoder().decode(plain), rotated };
    } catch { /* wrong key: try the next */ }
  }
  requireThat(false, 'Home-access details could not be decrypted with the configured vault key.', 500, 'vault_decrypt_failed');
}
