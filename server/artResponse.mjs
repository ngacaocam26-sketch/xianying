import { validateVisual, VISUAL_KEYS } from '../src/visual.ts';

export const VISUAL_SCHEMA = { type: 'object', additionalProperties: false,
  properties: Object.fromEntries(VISUAL_KEYS.map(key => [key, { type: 'number' }])), required: [...VISUAL_KEYS] };
export const SCULPTURE_RESPONSE_FORMAT = { type: 'json_schema', json_schema: {
  name: 'xianying_sculpture', strict: true, schema: { type: 'object', additionalProperties: false,
    properties: { visual: VISUAL_SCHEMA }, required: ['visual'] } } };

export const ART_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'xianying_reply', strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        reply: { type: 'string' },
        visual: VISUAL_SCHEMA,
      },
      required: ['reply', 'visual'],
    },
  },
};

// Only expose the first JSON string field, so JSON syntax/visual parameters never
// leak into the conversation. Incomplete escapes wait for the next stream chunk.
export function partialReply(source) {
  const match = /^\s*\{\s*"reply"\s*:\s*"/.exec(source);
  if (!match) return '';
  let text = '';
  const escapes = { '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
  for (let i = match[0].length; i < source.length; i++) {
    const char = source[i];
    if (char === '"') return text;
    if (char === '\\') {
      const next = source[++i];
      if (next === undefined) break;
      if (next === 'u') {
        const hex = source.slice(i + 1, i + 5);
        if (hex.length < 4) break;
        if (!/^[a-fA-F0-9]{4}$/.test(hex)) throw new Error('Invalid unicode escape');
        text += String.fromCharCode(parseInt(hex, 16)); i += 4;
      } else {
        if (!(next in escapes)) throw new Error('Invalid JSON escape');
        text += escapes[next];
      }
    } else {
      if (char.charCodeAt(0) < 32) throw new Error('Invalid JSON string');
      text += char;
    }
  }
  // Do not display a dangling surrogate between two streamed Unicode escapes.
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}

export function parseArtResponse(source) {
  const value = JSON.parse(source);
  if (typeof value?.reply !== 'string' || !value.reply.trim() || value.reply.length > 4000) {
    throw new Error('Invalid reply');
  }
  return { reply: value.reply, visual: validateVisual(value.visual) };
}
