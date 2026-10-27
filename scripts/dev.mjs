import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { createApiHandler, readConfig } from '../server/api.mjs';
import { attachVoiceServer } from '../server/voice.mjs';

// One command starts both services. The API receives an available local port.
const config = readConfig();
const api = createHttpServer(createApiHandler({ config }));
const voice = attachVoiceServer(api, { config });
await new Promise((resolve, reject) => {
  api.once('error', reject);
  api.listen(0, '127.0.0.1', resolve);
});
let vite;
try {
  vite = await createViteServer({
    server: {
      host: '127.0.0.1',
      open: process.argv.includes('--open'),
      proxy: { '/api': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: false, ws: true } },
    },
  });
  await vite.listen();
  vite.printUrls();
  console.log(config.apiKey
    ? `显影文字对话：已读取本机配置（${config.model}），实际连通性待发送验证。`
    : '显影文字对话：尚未配置 API Key。填写项目 .env 后重启；粒子和照片可照常使用。');
} catch (error) {
  voice.close();
  api.close();
  await vite?.close();
  throw error;
}
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  voice.close();
  api.closeAllConnections();
  await Promise.all([new Promise((resolve) => api.close(resolve)), vite.close()]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
