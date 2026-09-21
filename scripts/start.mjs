import { cp, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { createRequire } from 'node:module';
try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
// A static login page can render even when the dashboard's database client is
// missing. Check the workspace client before reporting that the server is ready.
try {
  const { PrismaClient } = createRequire(import.meta.url)('@prisma/client');
  const client = new PrismaClient();
  if (!client.order || !client.user) throw new Error('SignCraft Prisma models are missing.');
  await client.$disconnect();
} catch (cause) {
  throw new Error('Prisma client is unavailable. Run npm ci, then npm run build before starting SignCraft. No database reset or seed is required.', { cause });
}
await access('.next/standalone/server.js');
await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
await cp('public', '.next/standalone/public', { recursive: true });
const server = spawn(process.execPath, ['.next/standalone/server.js'], {
  stdio: 'inherit', env: { ...process.env, HOSTNAME: process.env.SIGNCRAFT_HOST || '127.0.0.1' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code ?? 0));
