import { spawn } from 'node:child_process';

const children = [
  spawn('node', ['--import', 'tsx', '--watch', 'server/index.ts'], { stdio: 'inherit', env: process.env }),
  spawn('node', ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { stdio: 'inherit', env: process.env }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) child.on('exit', code => stop(code ?? 0));
