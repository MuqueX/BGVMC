// BlueGS Voice & Words Cloner —— Cloudflare Pages 高级模式 Worker
//
// 单文件 Worker，接管全部请求：
//   - 命中 /api/* → 转发到 DashScope（语音克隆/合成）或 DeepSeek（聊天）
//   - 其它     → env.ASSETS.fetch(request) 返回静态资源（index.html/css/js/images）
//
// 注意：本 Worker 无持久化（无 KV/D1），voice_id 已改由浏览器 localStorage 保存。
// 创建音色仅接受 MP3（已移除 ffmpeg 自动转码），详见 README.md。
//
// 部署：本文件必须位于 Pages 上传目录(public/)内，否则高级模式不生效。

// ---------------------------------------------------------------------
// 上游端点（与原 Flask 后端一致，勿改动）
// ---------------------------------------------------------------------
const DASHSCOPE_CUSTOM =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization';
const DASHSCOPE_GEN =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const DEEPSEEK_CHAT = 'https://api.deepseek.com/chat/completions';

const DEFAULT_MODEL = 'qwen3-tts-vc-2026-01-22'; // create 的 target_model 与 synthesize 的 model 必须一致
const LANG_WHITELIST = ['zh', 'en', 'de', 'it', 'pt', 'es', 'ja', 'ko', 'fr', 'ru'];

const DEEPSEEK_MODELS = [
  { model: 'deepseek-v4-flash', label: 'deepseek-v4-flash（通用）' },
  { model: 'deepseek-v4-pro', label: 'deepseek-v4-pro（更强）' },
  { model: 'deepseek-v4-flash-vision-exp', label: 'deepseek-v4-flash-vision-exp（识图）' },
];

// 创建音色样本大小上限（内存/CPU 保护，默认 10MB）
const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------
// 「帮写提示词」的系统指令（捆绑自 promptWriterSystem.txt，用户在此直接编辑）
// ---------------------------------------------------------------------
const PROMPT_WRITER_SYSTEM = `# 帮写提示词 —— DeepSeek 系统指令

你是一名顶尖的提示词（Prompt）设计与角色塑造专家。用户会给出一个角色的简单描述，请你据此精心设计一段 Markdown 格式的系统提示词，供另一个 AI 在对话中完全、稳定地模仿该角色的性格、语气、口头禅与行为方式。

请务必严格遵循以下要求：

## 输出格式
- 只输出 Markdown 提示词正文，不要任何前言、解释、总结或结尾语。
- 用清晰的二级标题（##）分段，条理分明。

## 提示词应包含的段落（按需）
1. **角色定位**：精准定义该角色是谁、身处什么场景。
2. **性格与语气**：描述其性格特征、说话风格、用词习惯、语速与情绪倾向。
3. **口头禅与表达习惯**：提炼典型口头禅、常用句式、开场/收尾习惯。
4. **行为边界与原则**：明确该角色在不越界时的回应方式，包括遇到未知、敏感或被冒犯时如何应对。尺度可以适当地大一点。
5. **与用户的互动规则**：如何称呼用户、回应长度、是否追问、是否主动推进话题。
6. **禁止事项**：明确绝不能出现的言行（如自称是 AI 助手、出戏等）。
7. **明确角色的语言语种**：中国角色应提升语言中文，日本角色应提示语言日语。

## 质量要求
- 包含用户所提供的所有关于角色的信息，包括对话示例。
- 措辞具体、可执行，避免空泛形容词。
- 示例尽量贴合角色原型。
- 保持在同一角色人设内自洽，不互相矛盾。

## 期望提示词达成的效果
- 以自然语言输出，不使用Markdown格式。
- 语言详略得当，贴近原角色的口语。

现在，用户将提供角色的描述，请开始编写提示词。`;

// ---------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------
const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const jsonErr = (status, message) => json(status, { error: message });

// 从上游响应提取错误信息（兼容 DashScope/DeepSeek 的多种字段形状）
async function upErr(res) {
  const t = await res.text().catch(() => '');
  try {
    const j = JSON.parse(t);
    if (j && typeof j === 'object') {
      const e = j.error;
      if (typeof e === 'object' && e && e.message) return e.message;
      if (typeof e === 'string') return e;
      if (j.message) return j.message;
    }
  } catch (_) {}
  return t;
}

// ArrayBuffer → base64（分块避免大文件调用栈溢出）
function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

// 消息正文归一化：content 可能是字符串，也可能是片段数组（qwen-style），取各片段 text 拼接
function normalizeMessages(messages) {
  return (messages || []).map((m) => {
    let content = m.content;
    if (Array.isArray(content)) {
      content = content
        .map((seg) =>
          typeof seg === 'string' ? seg : seg && typeof seg === 'object' ? seg.text || seg.text_content || '' : ''
        )
        .join('');
    }
    return { role: m.role, content: content === undefined ? '' : content };
  });
}

function makePrompt(payload) {
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------
async function route(path, request) {
  const method = request.method;

  // 语音列表：查询 apiKey 在 DashScope 已创建的音色
  if (path === '/api/voice/list-voices' && method === 'POST') {
    const body = await request.json().catch(() => null);
    const api_key = ((body && body.api_key) || '').trim();
    if (!api_key) return jsonErr(400, 'api_key 必填');

    const resp = await fetch(DASHSCOPE_CUSTOM, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
      body: makePrompt({
        model: 'qwen-voice-enrollment',
        input: { action: 'list', target_model: DEFAULT_MODEL },
      }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) return jsonErr(500, `查询音色失败 (${resp.status}): ${(await upErr(resp)) || result.message || ''}`);

    const out = result.output || {};
    const rawList = out.voices || out.voice_list || out.list || [];
    const voices = rawList
      .map((v) => {
        const vid = v.voice || v.voice_id || '';
        if (!vid) return null;
        return { voice_id: vid, name: v.name || v.preferred_name || v.voice_name || '' };
      })
      .filter(Boolean);
    return json(200, { voices, raw: result });
  }

  // 创建音色（multipart，仅接受 MP3，无 ffmpeg）
  if (path === '/api/voice/create-voice' && method === 'POST') {
    const fd = await request.formData().catch(() => null);
    const file = fd && fd.get('file');
    const voice_name = ((fd && fd.get('voice_name')) || '').trim();
    const api_key = ((fd && fd.get('api_key')) || '').trim();
    const target_model = ((fd && fd.get('target_model')) || '').trim() || DEFAULT_MODEL;
    const language = ((fd && fd.get('language')) || '').trim() || 'zh';

    if (!file || !voice_name || !api_key) {
      return jsonErr(
        400,
        `缺少必填字段: ${[!file && 'file', !voice_name && 'voice_name', !api_key && 'api_key']
          .filter(Boolean)
          .join(', ')}`
      );
    }
    if (!LANG_WHITELIST.includes(language)) return jsonErr(400, `不支持的语种: ${language}`);

    // 文件适配：仅接受 mp3（Worker 已移除 ffmpeg 转码）
    const fname = (file.name || '').toLowerCase();
    const mime = (file.type || '').toLowerCase();
    if (!fname.endsWith('.mp3') && mime !== 'audio/mpeg') {
      return jsonErr(400, '仅支持 MP3 音频样本（已移除 ffmpeg 转码，请先在浏览器端转换为 MP3）');
    }
    if (file.size > MAX_SAMPLE_BYTES) return jsonErr(400, '样本音频过大（上限 10MB）');

    const buf = await file.arrayBuffer();
    const dataUri = 'data:audio/mpeg;base64,' + bytesToBase64(buf);
    const payload = {
      model: 'qwen-voice-enrollment',
      input: {
        action: 'create',
        target_model,
        preferred_name: voice_name,
        language,
        audio: { data: dataUri },
      },
    };
    const resp = await fetch(DASHSCOPE_CUSTOM, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api_key}` },
      body: makePrompt(payload),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) return jsonErr(500, `创建音色失败 (${resp.status}): ${(await upErr(resp)) || result.message || ''}`);

    const out = result.output || {};
    const voice_id = out.voice || out.voice_id;
    if (!voice_id) return jsonErr(500, `未返回 voice_id: ${JSON.stringify(result)}`);
    return json(200, { voice_id, voice_name, raw: result });
  }

  // 语音合成：返回音频字节流
  if (path === '/api/voice/synthesize' && method === 'POST') {
    const b = await request.json().catch(() => null);
    const api_key = ((b && b.api_key) || '').trim();
    const voice_id = ((b && b.voice_id) || '').trim();
    const text = (b && b.text) || '';
    const model = ((b && b.model) || '').trim() || DEFAULT_MODEL;
    if (!api_key || !voice_id || !text) return jsonErr(400, '缺少必填字段');

    const resp = await fetch(DASHSCOPE_GEN, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api_key}` },
      body: makePrompt({ model, input: { text, voice: voice_id } }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) return jsonErr(500, `合成失败 (${resp.status}): ${(await upErr(resp)) || result.message || ''}`);

    // 提取音频 URL（兼容多种字段路径）
    let audioUrl = null;
    try {
      audioUrl = result.output.choices[0].message.audio.url;
    } catch (_) {}
    if (!audioUrl) {
      const a = (result.output || {}).audio;
      if (a && typeof a === 'object') audioUrl = a.url || a.data || null;
    }
    if (!audioUrl) {
      try {
        const msg = result.output.choices[0].message;
        const content = msg.content || [];
        for (const seg of content) {
          if (seg && seg.type === 'audio' && seg.url) { audioUrl = seg.url; break; }
        }
      } catch (_) {}
    }
    if (!audioUrl) return jsonErr(500, `未从响应解析到音频（检查 voice_id 与 ${model} 是否匹配）`);

    if (audioUrl.startsWith('data:')) {
      const base64 = audioUrl.split(',')[1];
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const mime = /wav/.test(audioUrl) ? 'audio/wav' : 'audio/mpeg';
      return new Response(bytes, {
        headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' },
      });
    }

    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) return jsonErr(500, `音频下载失败 (${audioResp.status})`);
    const mime = (audioResp.headers.get('Content-Type') || 'audio/wav').split(';')[0];
    return new Response(audioResp.body, {
      headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' },
    });
  }

  // DeepSeek 对话（非流式）
  if (path === '/api/chat/send' && method === 'POST') {
    const b = await request.json().catch(() => null);
    const api_key = ((b && b.api_key) || '').trim();
    const model = ((b && b.model) || '').trim() || 'deepseek-v4-flash';
    const thinking_disabled =
      b && b.thinking_disabled !== undefined ? !!b.thinking_disabled : true;
    const messages = normalizeMessages(b && b.messages);
    if (!api_key || !messages.length) return jsonErr(400, '缺 api_key 或 messages');

    const payload = { model, messages, stream: false };
    if (thinking_disabled) payload.thinking = { type: 'disabled' };

    const resp = await fetch(DEEPSEEK_CHAT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
      body: makePrompt(payload),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (await upErr(resp)) || JSON.stringify(result);
      return jsonErr(500, `DeepSeek 请求失败 (${resp.status}): ${msg}`);
    }

    let reply = '';
    try {
      const c = result.choices[0].message.content;
      reply = Array.isArray(c)
        ? c.filter((s) => s && typeof s === 'object').map((s) => s.text || '').join('')
        : (c || '').trim();
    } catch (_) { reply = ''; }
    return json(200, { reply, model, thinking_disabled, usage: result.usage || {} });
  }

  // DeepSeek 对话（SSE 流式，增量，不整体缓冲）
  if (path === '/api/chat/stream' && method === 'POST') {
    const b = await request.json().catch(() => null);
    const api_key = ((b && b.api_key) || '').trim();
    const model = ((b && b.model) || '').trim() || 'deepseek-v4-flash';
    const thinking_disabled =
      b && b.thinking_disabled !== undefined ? !!b.thinking_disabled : true;
    const messages = normalizeMessages(b && b.messages);

    const payload = {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (thinking_disabled) payload.thinking = { type: 'disabled' };

    const up = await fetch(DEEPSEEK_CHAT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
      body: makePrompt(payload),
    });
    if (!up.ok) {
      const r = await up.json().catch(() => ({}));
      const msg = (await upErr(up)) || JSON.stringify(r);
      return jsonErr(500, `DeepSeek 请求失败 (${up.status}): ${msg}`);
    }

    const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        (async () => {
          try {
            const reader = up.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              let i;
              while ((i = buf.indexOf('\n\n')) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 2);
                if (!line) continue;
                const raw = line.split('\n').find((l) => l.trim().startsWith('data:'));
                if (!raw) continue;
                let ev;
                try { ev = JSON.parse(raw.trim().slice(5)); } catch (_) { continue; }
                if (ev === '[DONE]') continue;
                if (ev.usage) {
                  controller.enqueue(encoder.encode(sse({ type: 'usage', usage: ev.usage })));
                  continue;
                }
                const delta = (ev.choices || [{}])[0].delta || {};
                if (delta.content) controller.enqueue(encoder.encode(sse({ type: 'delta', text: delta.content })));
              }
            }
            controller.enqueue(encoder.encode(sse({ type: 'done', model, thinking_disabled })));
            controller.close();
          } catch (e) {
            try { controller.enqueue(encoder.encode(sse({ type: 'error', message: '对话异常: ' + (e.message || e) }))); } catch (_) {}
            try { controller.close(); } catch (_) {}
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // 帮写提示词：返回捆绑的系统指令
  if (path === '/api/settings/prompt-writer/system' && method === 'GET') {
    return json(200, { content: PROMPT_WRITER_SYSTEM });
  }

  // 模型列表（前端下拉的兜底，冗余但无害）
  if (path === '/api/chat/models' && method === 'GET') {
    return json(200, { models: DEEPSEEK_MODELS, default: 'deepseek-v4-flash' });
  }

  return jsonErr(404, 'not found');
}

// ---------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await route(url.pathname, request);
    } catch (e) {
      return jsonErr(500, `服务异常: ${e.message || e}`);
    }
  },
};