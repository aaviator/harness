#!/usr/bin/env node
// Sudo escalation wrapper for Claude Code
// Installed at: /usr/local/bin/claude-wrapper
// Called by SDK as: node /usr/local/bin/claude-wrapper <args>
// Spawns:          sudo /usr/bin/node /real/claude.js <args>
//
// HOME is preserved via sudoers env_keep so Claude reads ~/.claude/ auth.

'use strict';
const { spawn } = require('child_process');
const { appendFileSync } = require('fs');

const REAL_CLAUDE = '/pool_app/teal-lab1/www/lab1.bedhead.tech/public_html/etc/harness/claude-code-webui/backend/node_modules/@anthropic-ai/claude-code/cli.js';
const NODE = '/usr/bin/node';
const LOG = '/tmp/claude-wrapper.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  try { appendFileSync(LOG, line); } catch {}
}

log(`invoked uid=${process.getuid()} HOME=${process.env.HOME}`);
log(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? 'set' : 'NOT SET'}`);
log(`args: ${process.argv.slice(2).slice(0, 4).join(' ')}…`);

log(`full args: ${JSON.stringify(process.argv.slice(2))}`);

// Diagnostic: list what sudo allows
try {
  const { execFileSync } = require('child_process');
  const perms = execFileSync('sudo', ['-nl'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  log(`sudo -nl:\n${perms.trim()}`);
} catch(e) { log(`sudo -nl failed: ${e.stderr || e.message}`); }

const child = spawn('sudo', ['-n', '-E', NODE, REAL_CLAUDE, ...process.argv.slice(2)], {
  stdio: ['inherit', 'inherit', 'pipe'],
  env: { ...process.env, IS_SANDBOX: '1' },
});

let stderrBuf = '';
child.stderr.on('data', (d) => {
  stderrBuf += d.toString();
  process.stderr.write(d);
});

child.on('exit', (code, signal) => {
  if (stderrBuf) log(`sudo stderr: ${stderrBuf.trim()}`);
  log(`exit code=${code} signal=${signal}`);
  process.exit(code ?? (signal ? 1 : 0));
});

child.on('error', (err) => {
  log(`spawn error: ${err.message}`);
  process.exit(1);
});
