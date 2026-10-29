import { SYSTEM_PROMPT, SCULPTURE_PROMPT, TITLE_PROMPT } from './prompt.mjs';
import { ART_RESPONSE_FORMAT, SCULPTURE_RESPONSE_FORMAT, TITLE_RESPONSE_FORMAT, partialReply, parseArtResponse, parseForm, parseTitle } from './artResponse.mjs';
import { DEFAULT_VISUAL, validateVisual } from '../src/visual.ts';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function readConfig(env = process.env) {
  const workspace = (env.DASHSCOPE_WORKSPACE_ID ?? '').trim();
  if (workspace && !/^[a-zA-Z0-9-]+$/.test(workspace)) {
    throw new Error('DASHSCOPE_WORKSPACE_ID 格式不正确，请填写北京业务空间 ID。');
  }
  return {
    apiKey: (env.DASHSCOPE_API_KEY ?? '').trim(),
    model: (env.QWEN_MODEL ?? '').trim() || 'qwen3.8-flash',
    realtimeModel: (env.QWEN_REALTIME_MODEL ?? '').trim() || 'qwen3.8-omni-flash-realtime',
    realtimeVoice: (env.QWEN_REALTIME_VOICE ?? '').trim() || 'Tina',
    baseUrl: workspace
      ? `https://${workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
      : 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  };
}

function validateMessages(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 11 ||
      messages.length % 2 !== 1) {
    throw new ApiError(400, 'INVALID_INPUT', '对话内容格式不正确，请开始一段新对话。');
  }
  let length = 0;
  const clean = messages.map((message, index) => {
    const role = index % 2 === 0 ? 'user' : 'assistant';
    if (message?.role !== role || typeof message.content !== 'string' ||
        !message.content.trim() || message.content.length > (role === 'user' ? 2000 : 4000)) {
      throw new ApiError(400, 'INVALID_INPUT', '每次请写 1—2000 个字，再发送。');
    }
    length += message.content.length;
    return { role, content: message.content.trim() };
  });
  if (length > 24000) throw new ApiError(400, 'CONTEXT_LIMIT', '这段对话太长了，请开始一段新对话。');
  return clean;
}

function validateUtterances(body) {
  const words = body?.utterances;
  if (body?.image != null || !Array.isArray(words) || !words.length || words.length > 5 ||
    words.some(word => typeof word !== 'string' || !word.trim() || word.length > 2000) ||
    words.join('').length > 8000) throw new ApiError(400, 'INVALID_INPUT', '这段表达暂时无法显影，请说一句简短的话再试。');
  return [{ role: 'user', content: '按顺序的用户表达：' + JSON.stringify(words.map(word => word.trim())) }];
}

// 凝结命名：最近的文字或语音记录，最多 12 句，至少有一句是用户说的。
function validateTranscript(body) {
  const lines = body?.lines;
  if (body?.image != null || !Array.isArray(lines) || !lines.length || lines.length > 12 ||
    lines.some(line => !['user', 'assistant'].includes(line?.role) || typeof line.text !== 'string' ||
      !line.text.trim() || line.text.length > (line.role === 'user' ? 2000 : 4000)) ||
    !lines.some(line => line.role === 'user') || lines.reduce((sum, line) => sum + line.text.length, 0) > 12000) {
    throw new ApiError(400, 'INVALID_INPUT', '这段对话暂时无法命名，可以自己写一个名字。');
  }
  return [{ role: 'user', content: '这次对话的记录：' + JSON.stringify(lines.map(line => ({ role: line.role, text: line.text.trim() }))) }];
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new ApiError(415, 'INVALID_TYPE', '请求格式不正确，请刷新页面后重试。');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 448 * 1024) throw new ApiError(413, 'TOO_LARGE', '内容或照片缩略图太大，请缩短或重新选择。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'INVALID_JSON', '请求格式不正确，请刷新页面后重试。');
  }
}

function validateImage(image) {
  if (image == null) return null;
  if (typeof image.dataUrl !== 'string' || image.dataUrl.length > 320000 ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl) ||
      !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width < 1 || image.height < 1 || image.width > 768 || image.height > 768) {
    throw new ApiError(400, 'INVALID_IMAGE', '照片缩略图格式不正确，请重新选择照片。');
  }
  const base64 = image.dataUrl.slice('data:image/jpeg;base64,'.length);
  const bytes = Buffer.from(base64, 'base64');
  if (base64.length % 4 || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new ApiError(400, 'INVALID_IMAGE', '照片缩略图读取失败，请重新选择照片。');
  }
  return image.dataUrl;
}

// SSE chunks may split in the middle of a Chinese character or a data line.
async function* readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
      if (buffer.length > 128 * 1024) throw new Error('Invalid upstream frame');
      if (done) {
        if (buffer.startsWith('data:')) yield buffer.slice(5).trim();
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function providerError(status) {
  if (status === 401) return new ApiError(503, 'AUTH_FAILED', 'AI 服务的密钥未通过验证，请检查本机配置后重启。');
  if (status === 403) return new ApiError(503, 'ACCESS_DENIED', 'AI 服务暂不可用，请检查模型权限、免费额度和账户状态。');
  if (status === 429) return new ApiError(429, 'PROVIDER_BUSY', 'AI 服务现在有点忙，稍后再试。');
  if (status === 400 || status === 404) return new ApiError(502, 'MODEL_UNAVAILABLE', '当前模型未能处理请求，请检查型号和地域配置。');
  return new ApiError(502, 'UPSTREAM_ERROR', '这次没有连上 AI 服务，文字还在，可以重试。');
}

export function createApiHandler({
  config = readConfig(), fetchImpl = fetch, timeoutMs = 45000, maxRequests = 20,
} = {}) {
  let active = 0;
  let requests = [];
  return async (req, res) => {
    const path = req.url?.split('?')[0];
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };
    const emit = (payload) => {
      if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(payload)}\n`);
    };
    // Development service is loopback-only. Reject cross-site browser requests.
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw new Error();
      } catch {
        json(403, { code: 'ORIGIN_DENIED', message: '请从显影页面发起请求。' });
        return;
      }
    }
    if (path === '/api/status' && req.method === 'GET') {
      json(200, { configured: Boolean(config.apiKey), provider: '阿里云百炼', model: config.model,
        realtimeModel: config.realtimeModel });
      return;
    }
    const sculpture = path === '/api/sculpture';
    const naming = path === '/api/title';
    if ((!sculpture && !naming && path !== '/api/chat') || req.method !== 'POST') {
      json(404, { code: 'NOT_FOUND', message: '接口不存在。' });
      return;
    }
    let counted = false;
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.on('close', onClose);
    req.setTimeout(10000, () => req.destroy());
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = await readJson(req);
      const messages = naming ? validateTranscript(body) : sculpture ? validateUtterances(body) : validateMessages(body);
      const image = validateImage(body.image);
      const currentVisual = validateVisual(body.visual) ?? DEFAULT_VISUAL;
      const currentForm = parseForm(body.form);
      if (image) {
        const latest = messages.at(-1);
        latest.content = [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: latest.content },
        ];
      }
      req.setTimeout(0);
      if (!config.apiKey) throw new ApiError(503, 'NOT_CONFIGURED', '文字对话尚未连接。请在本机 .env 中填入 API Key，并重启项目。');
      const now = Date.now();
      requests = requests.filter((time) => now - time < 60000);
      if (active >= 2 || requests.length >= maxRequests) {
        throw new ApiError(429, 'RATE_LIMIT', '先缓一会儿，稍后再发送。');
      }
      requests.push(now);
      active++;
      counted = true;
      const upstream = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'system', content: naming ? TITLE_PROMPT
            : (sculpture ? SCULPTURE_PROMPT : SYSTEM_PROMPT) + '\n当前作品参数：' + JSON.stringify(currentVisual)
              + '\n当前意象：' + (currentForm ? JSON.stringify(currentForm) : '尚未选择') }, ...messages],
          response_format: naming ? TITLE_RESPONSE_FORMAT : sculpture ? SCULPTURE_RESPONSE_FORMAT : ART_RESPONSE_FORMAT,
          stream: !sculpture && !naming,
          enable_thinking: false,
          max_tokens: naming ? 200 : sculpture ? 350 : 900,
        }),
        signal: controller.signal,
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        throw providerError(upstream.status);
      }
      if (naming) {
        const result = await upstream.json();
        const choice = result.choices?.[0];
        const content = choice?.message?.content;
        if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || content.length > 4000) throw new Error('Incomplete title');
        json(200, parseTitle(content)); return;
      }
      if (sculpture) {
        const result = await upstream.json();
        const choice = result.choices?.[0];
        const content = choice?.message?.content;
        if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || content.length > 8000) throw new Error('Incomplete sculpture');
        const parsed = JSON.parse(content);
        const visual = validateVisual(parsed.visual, false);
        if (!visual) throw new Error('Invalid sculpture');
        json(200, { visual, form: parseForm(parsed.form) }); return;
      }
      if (!upstream.body) throw new Error('Empty upstream body');
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      let received = '';
      let sentReply = '';
      let finished = false;
      for await (const data of readSse(upstream.body)) {
        if (!data) continue;
        if (data === '[DONE]') break;
        const chunk = JSON.parse(data);
        if (chunk.error) throw new Error('Upstream stream error');
        const choice = chunk.choices?.[0];
        const content = choice?.delta?.content;
        if (typeof content === 'string' && content) {
          received += content;
          if (received.length > 16000) throw new ApiError(502, 'OUTPUT_LIMIT', '回复过长，已停止。可以换个简短的说法重试。');
          const reply = partialReply(received);
          if (reply.length > 4000) throw new ApiError(502, 'OUTPUT_LIMIT', '回复过长，已停止。可以换个简短的说法重试。');
          if (!reply.startsWith(sentReply)) throw new Error('Invalid reply stream');
          if (reply.length > sentReply.length) emit({ type: 'delta', text: reply.slice(sentReply.length) });
          sentReply = reply;
        }
        if (choice?.finish_reason === 'stop') finished = true;
        else if (choice?.finish_reason) throw new ApiError(502, 'INCOMPLETE', '这次回复没有完整生成，可以重试。');
      }
      if (!finished || !received.trim()) throw new Error('Incomplete upstream stream');
      const result = parseArtResponse(received);
      if (!result.reply.startsWith(sentReply)) throw new Error('Invalid final reply');
      if (result.reply.length > sentReply.length) emit({ type: 'delta', text: result.reply.slice(sentReply.length) });
      emit({ type: 'done', visual: result.visual, form: result.form,
        visualWarning: result.visual ? undefined : '回复已收到，画面暂时保留。' });
      res.end();
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      const failure = error instanceof ApiError ? error : controller.signal.aborted
        ? new ApiError(504, 'TIMEOUT', '等待有些久了，已停止这次请求。你的文字还在，可以重试。')
        : new ApiError(502, 'CONNECTION_FAILED', '连接中断了，已有文字会保留，可以重试。');
      const payload = { code: failure.code, message: failure.message };
      // Never relay raw provider error bodies, credentials, or private input to logs.
      if (res.headersSent) { emit({ type: 'error', ...payload }); res.end(); }
      else json(failure.status, payload);
    } finally {
      clearTimeout(timer);
      req.setTimeout(0);
      res.off('close', onClose);
      controller.abort();
      if (counted) active--;
    }
  };
}
