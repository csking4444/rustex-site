#!/usr/bin/env node
/**
 * Rustex one-step Rust+ connect.
 *
 * Run this, then pair from the game. When the pairing arrives it opens Rustex with the server
 * details already filled in, so nothing is copied by hand.
 *
 *   npx @liamcottle/rustplus.js fcm-register     # once, links your Steam account
 *   node rustex-connect.mjs                      # then this, and pair in game
 *
 * A web page cannot start a process on your machine, which is why this exists: the process on
 * your machine finishes the job in the page instead.
 *
 * Options:
 *   --site <url>     Rustex URL (default https://rustex-site.vercel.app)
 *   --config <path>  Path to rustplus.config.json (default: ./rustplus.config.json, then ~)
 *   --print          Print the details instead of opening a browser
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const site = opt('--site', 'https://rustex-site.vercel.app').replace(/\/$/, '');
const printOnly = args.includes('--print');

// The CLI resolves its config relative to the working directory, which is the usual reason
// "the listener does nothing" — it is running somewhere the file is not.
const configPath = opt('--config', null) ?? [
  path.join(process.cwd(), 'rustplus.config.json'),
  path.join(os.homedir(), 'rustplus.config.json'),
].find(existsSync);

if (!configPath) {
  console.error('No rustplus.config.json found.\n' +
    'Run this first:  npx @liamcottle/rustplus.js fcm-register\n' +
    'Then re-run from the same folder, or pass --config <path>.');
  process.exit(1);
}

console.log('Rustex Rust+ connect');
console.log('====================\n');
console.log('Using credentials: ' + configPath);
console.log('Listening for a pairing...\n');
console.log('In game: press ESC, open the Rust+ tab, and hit "Pair With Server".');
console.log('You must be connected to that server right now — Rust+ pairs the one you are on.\n');

// Spawned through npx so no global install is needed. shell:true is required on Windows for
// npx to resolve at all.
const child = spawn('npx', ['-y', '@liamcottle/rustplus.js', 'fcm-listen', '--config-file', configPath], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

let buffer = '';
let done = false;

child.stdout.on('data', chunk => {
  const text = chunk.toString();
  buffer += text;
  process.stdout.write(text);
  if (!done) tryPair(buffer);
});
child.stderr.on('data', c => process.stderr.write(c.toString()));

/** Pulls the pairing body out of whatever the listener printed. */
function tryPair(text) {
  // The useful payload is a JSON string under the "body" key of the notification.
  const match = text.match(/"body"[\s:,]*[`'"](\{.*?\})[`'"]/s)
    ?? text.match(/(\{[^{}]*"playerToken"[^{}]*\})/s);
  if (!match) return;

  let data;
  try { data = JSON.parse(match[1].replace(/\\\\/g, '\\')); } catch { return; }
  if (!data.ip || !data.port || !data.playerId || !data.playerToken) return;

  done = true;
  const url = `${site}/#pair?` + new URLSearchParams({
    ip: data.ip, port: String(data.port),
    playerId: String(data.playerId), playerToken: String(data.playerToken),
    name: data.name ?? '',
  }).toString();

  console.log('\n--------------------------------------------------');
  console.log('Paired with: ' + (data.name || data.ip));
  console.log('  address      ' + data.ip + ':' + data.port);
  console.log('  player id    ' + data.playerId);
  console.log('--------------------------------------------------\n');

  if (printOnly) {
    console.log('Open this to finish:\n  ' + url + '\n');
  } else {
    console.log('Opening Rustex to finish the connection...\n');
    openBrowser(url);
  }

  child.kill();
  setTimeout(() => process.exit(0), 400);
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd'
            : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const argv = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  spawn(cmd, argv, { detached: true, stdio: 'ignore' }).unref();
}

process.on('SIGINT', () => { child.kill(); process.exit(0); });
