import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler, readConfig } from '../server/api.mjs';
import { attachVoiceServer } from '../server/voice.mjs';

// Production: one port serves the built page (dist/), the API and voice WebSocket.
// HTTPS is handled by a reverse proxy (e.g. Caddy) in front of this process.
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2',
};

const config = readConfig();
const api = createApiHandler({ config });

async function sendFile(res, file, cache) {
  const body = await readFile(file);
  res.writeHead(200, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const path = req.url?.split('?')[0] ?? '/';
  if (path.startsWith('/api/')) { api(req, res); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  try {
    const file = normalize(join(root, decodeURIComponent(path)));
    if (file.startsWith(root) && !file.endsWith(sep) && (await stat(file).catch(() => null))?.isFile()) {
      // Vite fingerprints assets, so they can be cached for good.
      await sendFile(res, file, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return;
    }
    // Page routes (/, /relief-lab, /shape-studies) all load the same entry.
    await sendFile(res, join(root, 'index.html'), 'no-cache');
  } catch {
    if (!res.headersSent) res.writeHead(500).end();
  }
});
const voice = attachVoiceServer(server, { config });

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`显影已启动：http://${host}:${port}/`);
  console.log(config.apiKey ? `已读取 API Key（${config.model}）。` : '尚未配置 API Key：粒子和照片可用，AI 对话不可用。');
});

function shutdown() {
  voice.close();
  server.closeAllConnections();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
