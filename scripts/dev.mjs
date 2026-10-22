// 开发模式：先起 Vite dev server，再启动 Electron 指向它
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const server = await createServer({ configFile: path.join(root, 'vite.config.mjs') });
await server.listen();
const url = server.resolvedUrls?.local?.[0] || 'http://localhost:5183/';
server.printUrls();

const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env, cwd: root });
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', async () => {
  child.kill('SIGINT');
  await server.close();
  process.exit(0);
});
