# BlueGS Voice & Words Cloner — Cloudflare 版

基于 **Cloudflare Pages 高级模式** 的免服务器版本：一个 `_worker.js` 复刻了原 Flask 后端的全部 `/api/*` 转发，前端静态资源照常托管在 Pages 边缘节点。

> 本目录（`CF_release/`）与根目录的旧版（Flask + Nginx）互不干扰，旧版可继续使用。

## 架构

```
浏览器前端 (public/)  ──同源──▶  Cloudflare Pages _worker.js
                                   ├─ /api/*        → 转发 DashScope / DeepSeek
                                   └─ 其余静态文件  → env.ASSETS 返回
```

- **语音**：创建音色、查询音色、语音合成 → DashScope（qwen3-tts-vc-2026-01-22）
- **聊天**：DeepSeek `chat/completions`（支持流式 SSE）
- **帮写提示词**：`/api/settings/prompt-writer/system` 返回捆绑的系统指令
- 无任何后端持久化（无 KV/D1）：API Key、voice_id、预设、会话、音频缓存全部只存浏览器。

## 目录结构

```
CF_release/
├── package.json        # wrangler 脚本（dev / deploy）
├── README.md
└── public/             # ── 既是本地开发目录，也是 Pages 上传根目录 ──
    ├── _worker.js      # ★ 单文件 Worker（/api 代理 + 静态回退）
    ├── index.html
    ├── css/style.css
    └── js/app.js       # 前端（voice_id 已本地化、仅 MP3 校验）
```

> **重要**：`_worker.js` 必须放在 `public/`（上传目录）**内**，否则 Pages 高级模式不会生效。

## 本地运行 / 部署（Cloudflare Workers + Static Assets）

前置：安装 [Node](https://nodejs.org)（≥18），注册 [Cloudflare](https://dash.cloudflare.com)。

```bash
cd CF_release
npm install

# 本地开发（miniflare 起服务，出网请求是真实的，可填真实 Key 联调）
npm run dev
# 浏览器打开终端提示的本地地址（默认 http://localhost:8787）

# 登录并发布到 Cloudflare Workers
npx wrangler login
npm run deploy        # 等价于 npx wrangler deploy
# 完成后终端给出你的 *.workers.dev 地址，浏览器访问即可
```

`wrangler.toml` 关键点：
- `main = "public/_worker.js"` → Worker 运行时入口（处理 `/api/*`）
- `[assets] directory="./public" binding="ASSETS"` → 静态资源托管，Worker 里用 `env.ASSETS.fetch` 返回
- 推送代码后，用 `npx wrangler dev` 选中本机运行即可联调真实 DashScope/DeepSeek。

## 使用说明（行为差异：无 ffmpeg）

- **创建音色仅支持 MP3**：已移除 ffmpeg 自动转码。上传前请先把音频样本转换为 MP3（浏览器端做了前置校验，非 mp3 会直接提示）。
- **样本大小上限 10MB**（Free 计划 CPU/内存保护；更大可升级 Workers Paid 并放宽 `_worker.js` 里的 `MAX_SAMPLE_BYTES`）。
- **target_model 必须一致**：创建音色的 `target_model` 与合成时的 `model` 都固定为 `qwen3-tts-vc-2026-01-22`，勿改不一致，否则合成失败。
- **voice_id 存本浏览器**：创建成功后保存在 `localStorage['bluegsVoiceIds']`，换浏览器/设备不共享。
- **API Key 仅存本浏览器**：DashScope / DeepSeek Key 都不上传，随每次请求由浏览器直接发给 Worker 转发。

## 可自行修改的地方

- **帮写提示词系统指令**：编辑 `public/_worker.js` 顶部 `PROMPT_WRITER_SYSTEM` 字符串。
- **模型列表 / 语种白名单 / 最大体积**：均在 `public/_worker.js` 顶部常量区。
- **音色语种**：在 `public/_worker.js` 的 `LANG_WHITELIST`。

## 本地验证清单

1. 首页 / 两栏布局 / 多会话 / 设置弹窗正常加载。
2. 设置里填 DeepSeek Key → 发消息：回复、token 用量、逐字流式均正常。
3. 填 DashScope Key →「查询此 Key 的音色」列出音色。
4. 上传 **mp3** 创建音色成功，voice_id 出现在合成下拉；上传 wav/m4a 被拦截并提示仅支持 MP3。
5. 用创建的 voice_id 试听合成，能播放。
6. 「让 DeepSeek 帮写提示词」能载入捆绑系统指令。

## 常见问题

- **点击后无响应**：多为浏览器缓存旧 `app.js`，请强刷（Ctrl+Shift+R）。
- **创建音色失败、无音频**：确认上传的是 MP3、且 target_model 与合成 model 一致；可在浏览器 DevTools Network 看 Worker 返回的 `{error}`。
- **Request body 太大 / 超时**：Free 计划 HTTP 请求体上限 100MB、CPU 10ms；大文件 base64 编码可能触发 CPU 限制，请保持样本 ≤10MB，或升级 Workers Paid。