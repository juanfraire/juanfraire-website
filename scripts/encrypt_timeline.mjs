#!/usr/bin/env node
// Encrypt the timeline's data so that /timeline/ needs a password.
//
// The site is a public repo served as is, so the data cannot simply be hidden: it is published
// encrypted, as timeline/data/timeline.enc.json, and timeline/unlock.js decrypts it in the browser.
// AES-256-GCM, with the key derived from the password by PBKDF2-SHA256 (600,000 iterations,
// random salt). The readable data never enters the repo: its path is "timeline" in
// scripts/sources.local.json (git-ignored), and the file may be `window.TIMELINE = {…};` or plain JSON.
//
//     node scripts/encrypt_timeline.mjs                 # asks for the password twice, hidden
//     TIMELINE_PASSWORD=… node scripts/encrypt_timeline.mjs   # without a terminal
//
// Run it again after regenerating the data, or to change the password: visitors who chose
// "Remember on this device" are then asked again. Node 20 or later, no dependencies.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(SITE, 'timeline/data/timeline.enc.json');
const ITERATIONS = 600_000;
const MIN_LENGTH = 12;

function source() {
  if (process.argv[2]) return process.argv[2];
  const local = JSON.parse(readFileSync(join(SITE, 'scripts/sources.local.json'), 'utf8'));
  if (!local.timeline) throw new Error('no "timeline" path in scripts/sources.local.json');
  return local.timeline;
}

function askHidden(question) {
  if (!process.stdin.isTTY) throw new Error('no terminal to ask for the password: set TIMELINE_PASSWORD');
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let typed = '';
  return new Promise((resolve) => {
    const done = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') { done(); resolve(typed); return; }
        if (c === '\u0003') { done(); process.exit(130); }                 // Ctrl-C
        if (c === '\u007f' || c === '\b') typed = typed.slice(0, -1);      // Backspace
        else typed += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function password() {
  if (process.env.TIMELINE_PASSWORD) return process.env.TIMELINE_PASSWORD;
  const first = await askHidden('Password for /timeline/: ');
  const again = await askHidden('Again: ');
  if (first !== again) throw new Error('the two passwords differ');
  return first;
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function main() {
  const raw = readFileSync(source(), 'utf8').trim();
  const json = raw.replace(/^window\.TIMELINE\s*=\s*/, '').replace(/;\s*$/, '');
  const places = JSON.parse(json).places?.length;                             // fails here if it is not the data
  const pass = await password();
  if (!pass) throw new Error('empty password');
  if (pass.length < MIN_LENGTH) {
    console.warn(`note: a password under ${MIN_LENGTH} characters keeps casual visitors out, but anyone who ` +
                 'downloads the encrypted file can guess it offline; a few words make a strong one');
  }

  const text = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', text.encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, text.encode(json)));

  writeFileSync(OUT, JSON.stringify({ format: 'aes-256-gcm/pbkdf2-sha256', iterations: ITERATIONS,
    salt: b64(salt), iv: b64(iv), data: b64(data) }) + '\n');
  console.log(`wrote timeline/data/timeline.enc.json: ${places} places, ${(data.length / 1024).toFixed(0)} KB encrypted`);
}

main().catch((e) => {
  console.error(`encrypt_timeline: ${e.message}`);
  process.exit(1);
});
