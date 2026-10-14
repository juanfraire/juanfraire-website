'use strict';
/* The timeline is behind a password. Its data is published only encrypted (data/timeline.enc.json,
 * written by scripts/encrypt_timeline.mjs: AES-256-GCM, key from the password by PBKDF2-SHA256)
 * and decrypted here, in the browser; then app.js starts the globe.
 * A right password is remembered as the derived key (never the password itself): for this tab,
 * or on this device when asked. A new encryption has a new salt, so remembered keys lapse.
 */
(() => {
  const lock = document.getElementById('lock');
  const form = lock.querySelector('form');
  const input = document.getElementById('lock-pw');
  const remember = document.getElementById('lock-remember');
  const status = lock.querySelector('.status');
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  let box, slot;

  const recall = () => { try { return sessionStorage.getItem(slot) || localStorage.getItem(slot); } catch { return null; } };
  const keep = (value, long) => { try { (long ? localStorage : sessionStorage).setItem(slot, value); } catch { /* private mode */ } };
  const forget = () => { try { sessionStorage.removeItem(slot); localStorage.removeItem(slot); } catch { /* private mode */ } };

  async function open(key) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.data));
    window.TIMELINE = JSON.parse(new TextDecoder().decode(plain));
    lock.remove();
    const app = document.createElement('script');
    app.src = 'app.js';
    document.body.append(app);
  }

  async function start() {
    if (!window.crypto || !crypto.subtle) {
      status.textContent = 'This browser cannot open the timeline (it needs a secure connection).';
      lock.hidden = false;
      return;
    }
    try {
      box = await (await fetch('data/timeline.enc.json', { cache: 'no-cache' })).json();
    } catch {
      status.textContent = 'The timeline is not available.';
      lock.hidden = false;
      return;
    }
    slot = 'timeline-key:' + box.salt;
    const saved = recall();
    if (saved) {
      try {
        await open(await crypto.subtle.importKey('raw', b64(saved), 'AES-GCM', false, ['decrypt']));
        return;
      } catch {
        forget();
      }
    }
    lock.hidden = false;
    input.focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!box) return;
    status.textContent = 'Opening…';
    form.inert = true;
    try {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(input.value), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt: b64(box.salt), iterations: box.iterations },
        base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
      const raw = toB64(await crypto.subtle.exportKey('raw', key));
      await open(key);                                  // throws on a wrong password
      keep(raw, remember.checked);
    } catch {
      form.inert = false;
      status.textContent = 'Wrong password.';
      input.select();
    }
  });

  start();
})();
