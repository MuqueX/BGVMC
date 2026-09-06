// BlueGS Voice & Words Cloner - 前端逻辑
'use strict';

const API_BASE = '/api';

const $ = (id) => document.getElementById(id);
const apiKeyEl   = $('apiKey');
const apiKeySelect = $('apiKeySelect');
const loadKeyBtn  = $('loadKeyBtn');
const saveKeyBtn  = $('saveKeyBtn');
const keyResult   = $('keyResult');
const listVoicesBtn = $('listVoicesBtn');
const voicesList  = $('voicesList');
const voiceNameEl = $('voiceName');
const sampleFileEl = $('sampleFile');
const createModelEl = $('createModel');
const createLangEl  = $('createLang');
const createBtn   = $('createBtn');
const createResult = $('createResult');
const voiceSelect  = $('voiceSelect');
const voiceIdManual = $('voiceIdManual');
const synthesizeText = $('synthesizeText');
const synthesizeModel = $('synthesizeModel');
const synthesizeBtn  = $('synthesizeBtn');
const synthesizeResult = $('synthesizeResult');
const audioPlayer = $('audioPlayer');

// 聊天（DeepSeek）元素
const dsKeySelect   = $('dsKeySelect');
const dsLoadKeyBtn  = $('dsLoadKeyBtn');
const dsSaveKeyBtn  = $('dsSaveKeyBtn');
const dsKey         = $('dsKey');
const dsKeyResult   = $('dsKeyResult');
const dsModel       = $('dsModel');
const dsThink       = $('dsThink');
const dsStream      = $('dsStream');
const dsPrompt      = $('dsPrompt');
const dsSendBtn     = $('dsSendBtn');
const chatThread    = $('chatThread');
const userAvatarImg = $('userAvatarImg');
const userAvatarFile = $('userAvatarFile');
const dsToken       = $('dsToken');
const dsMuteBtn     = $('dsMuteBtn');
const chatAudio     = $('chatAudio');

// 图片发送
const dsImageBtn     = $('dsImageBtn');
const dsImageFile    = $('dsImageFile');
const dsImgPreview   = $('dsImgPreview');
const dsImgPreviewImg = $('dsImgPreviewImg');
const dsImgRemove    = $('dsImgRemove');

// 设置弹窗
const settingsBtn      = $('settingsBtn');
const settingsModal    = $('settingsModal');
const settingsCloseBtn = $('settingsCloseBtn');

// 初始提示词
const dsSystemPrompt       = $('dsSystemPrompt');
const dsSystemPromptSave   = $('dsSystemPromptSave');
const dsSystemPromptResult = $('dsSystemPromptResult');
// DeepSeek 帮写提示词
const roleDesc      = $('roleDesc');
const dsPromptAiBtn = $('dsPromptAiBtn');
const dsPromptAiResult = $('dsPromptAiResult');

// 预设项目
const presetName     = $('presetName');
const presetSaveBtn  = $('presetSaveBtn');
const presetSelect   = $('presetSelect');
const presetLoadBtn  = $('presetLoadBtn');
const presetDeleteBtn = $('presetDeleteBtn');
const presetResult   = $('presetResult');

// ------------------------------------------------------------------
// 工具
// ------------------------------------------------------------------
function setBtn(btn, busy, label) {
    btn.disabled = busy;
    if (label !== undefined) btn.textContent = label;
}

function showResult(el, msg, ok = true) {
    el.innerHTML = `<span class="${ok ? 'ok' : 'err'}">${msg}</span>`;
}

// 安全解析 JSON：响应不是 JSON（如 nginx 502/404 的 HTML 错误页）时返回 null，不抛异常
async function safeJson(resp) {
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    try { return await resp.json(); } catch (_) { return null; }
}

function getApiKey() {
    const k = apiKeyEl.value.trim();
    if (!k) {
        showResult(createResult, '请先填写 DashScope API Key', false);
        apiKeyEl.focus();
        return null;
    }
    return k;
}

// 把 voice_id 加进下拉
function addVoiceOption(voiceId, name) {
    const opt = document.createElement('option');
    opt.value = voiceId;
    opt.textContent = `${name || 'voice'} (${voiceId})`;
    voiceSelect.appendChild(opt);
    voiceSelect.value = voiceId;
}

// ------------------------------------------------------------------
// 0. DashScope Key 管理（仅存浏览器本地 localStorage，不上传服务器）
// ------------------------------------------------------------------
const LOCAL_DS_KEYS = 'bluegsDsKeys';
function loadLocalApiKeys() {
    try { return JSON.parse(localStorage.getItem(LOCAL_DS_KEYS) || '[]'); }
    catch (_) { return []; }
}
function saveLocalApiKey(k) {
    const arr = loadLocalApiKeys();
    if (!arr.includes(k)) arr.push(k);
    try { localStorage.setItem(LOCAL_DS_KEYS, JSON.stringify(arr)); } catch (_) {}
    return arr;
}

function fillKeySelect(keys, keepCurrent) {
    const cur = apiKeySelect.value;
    apiKeySelect.innerHTML = '';
    if (!keys.length) {
        apiKeySelect.appendChild(new Option('— 暂无 —', ''));
        return;
    }
    apiKeySelect.appendChild(new Option('— 选择已保存的 Key —', ''));
    keys.forEach(k => {
        // 只显示前 6 + 后 4 位，避免下拉里铺满长串
        const mask = k.length > 12 ? `${k.slice(0,6)}…${k.slice(-4)}` : k;
        apiKeySelect.appendChild(new Option(mask, k));
    });
    if (keepCurrent && cur) apiKeySelect.value = cur;
}

async function loadApiKeys() {
    fillKeySelect(loadLocalApiKeys(), false);
}

loadKeyBtn.addEventListener('click', () => {
    const k = apiKeySelect.value;
    if (!k) { keyResult.textContent = '请先在下拉选择一个 Key'; return; }
    apiKeyEl.value = k;
    keyResult.textContent = '已载入';
});

saveKeyBtn.addEventListener('click', async () => {
    const k = apiKeyEl.value.trim();
    if (!k) { keyResult.textContent = '当前 Key 为空'; return; }
    const keys = saveLocalApiKey(k);
    fillKeySelect(keys, false);
    apiKeySelect.value = k;   // 选中刚保存的
    keyResult.textContent = '已保存（仅存本浏览器）';
});

// ------------------------------------------------------------------
// 查询 apiKey 在 DashScope 已创建的音色（调用 list-voices）
// ------------------------------------------------------------------
listVoicesBtn.addEventListener('click', async () => {
    const apiKey = getApiKey();
    if (!apiKey) { voicesList.textContent = '请先填入 API Key'; return; }
    setBtn(listVoicesBtn, true, '查询中…');
    voicesList.textContent = '正在查询 DashScope…';
    try {
        const resp = await fetch(`${API_BASE}/voice/list-voices`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({api_key: apiKey}),
        });
        const data = await safeJson(resp);
        if (!resp.ok || !data) {
            voicesList.textContent = `查询失败：${(data && data.error) || `${resp.status} ${resp.statusText}`}`;
            return;
        }
        const voices = data.voices || [];
        if (!voices.length) {
            voicesList.textContent = '该 Key 下暂无自定义音色';
            return;
        }
        // 渲染音色列表，点击即填入合成框并加入下拉
        voicesList.innerHTML = voices.map(v => {
            const vid = v.voice_id;
            const label = v.name ? `${v.name}（${vid}）` : vid;
            const safe = vid.replace(/'/g, '').replace(/"/g, '&quot;');
            return `<button class="btn chip" data-vid="${safe}" data-name="${v.name || ''}">${label}</button>`;
        }).join('');
        voicesList.querySelectorAll('.chip').forEach(b => {
            b.addEventListener('click', () => {
                const vid = b.dataset.vid;
                const nm = b.dataset.name;
                addVoiceOption(vid, nm);          // 加入合成下拉
                voiceSelect.value = vid;            // 选中
                voiceIdManual.value = vid;          // 同时填入手动框
                voicesList.textContent = `已选 ${nm || vid}`;
            });
        });
    } catch (e) {
        voicesList.textContent = `查询异常：${e}`;
    } finally {
        setBtn(listVoicesBtn, false, '查询此 Key 的音色');
    }
});



// voice_id 保存在本浏览器（Cloudflare 版无后端持久化）
const LOCAL_VOICE_IDS = 'bluegsVoiceIds';
function loadVoiceIdsLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_VOICE_IDS) || '[]'); }
    catch (_) { return []; }
}
function saveVoiceIdLocal(voiceId, name) {
    const arr = loadVoiceIdsLocal();
    if (!arr.some(v => v.voice_id === voiceId)) arr.push({voice_id: voiceId, name: name || ''});
    try { localStorage.setItem(LOCAL_VOICE_IDS, JSON.stringify(arr)); } catch (_) {}
}

// 启动时从本浏览器读取已存 voice_id 列表并填入合成下拉
function loadVoiceIds() {
    (loadVoiceIdsLocal() || []).forEach(v => addVoiceOption(v.voice_id, v.name));
}

// 启动时拉取已存 Key 列表
loadApiKeys();
// 启动时拉取已存 voice_id 列表
loadVoiceIds();

// ------------------------------------------------------------------
// 1. 创建音色
// ------------------------------------------------------------------
createBtn.addEventListener('click', async () => {
    const apiKey = getApiKey();
    if (!apiKey) return;

    const file = sampleFileEl.files[0];
    const voiceName = voiceNameEl.value.trim();
    if (!file) { showResult(createResult, '请选择音频样本文件', false); return; }
    if (!voiceName) { showResult(createResult, '请填写音色名称', false); return; }
    // 文件适配：仅接受 mp3（Cloudflare 版无 ffmpeg 转码）
    if (!/\.mp3$/i.test(file.name) && (file.type || '').toLowerCase() !== 'audio/mpeg') {
        showResult(createResult, '仅支持 MP3 音频样本（请先转换为 MP3）', false);
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showResult(createResult, '样本音频过大（上限 10MB）', false);
        return;
    }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('voice_name', voiceName);
    fd.append('api_key', apiKey);
    const createModel = createModelEl.value.trim() || 'qwen3-tts-vc-2026-01-22';
    fd.append('target_model', createModel);
    fd.append('language', createLangEl.value);

    setBtn(createBtn, true, '创建中…');
    showResult(createResult, '正在上传 MP3 创建音色…');

    try {
        const resp = await fetch(`${API_BASE}/voice/create-voice`, {
            method: 'POST',
            body: fd,
        });
        const data = await safeJson(resp);  // 502/404 HTML 时不抛错，返回 null
        if (!resp.ok) {
            const msg = (data && data.error) || `${resp.status} ${resp.statusText}`;
            showResult(createResult, `失败：${msg}`, false);
            return;
        }
        if (!data) {
            showResult(createResult, '响应格式异常（非 JSON），请检查后端日志', false);
            return;
        }
        const vName = data.voice_name || voiceName;
        addVoiceOption(data.voice_id, vName);
        saveVoiceIdLocal(data.voice_id, vName);   // 保存到本浏览器 localStorage
        showResult(createResult,
            `✅ 创建成功 voice_id=<code>${data.voice_id}</code>（已保存到本浏览器）`);
    } catch (err) {
        showResult(createResult, `请求异常：${err}`, false);
    } finally {
        setBtn(createBtn, false, '创建音色');
    }
});

// ------------------------------------------------------------------
// 2. 实时合成
// ------------------------------------------------------------------
synthesizeBtn.addEventListener('click', async () => {
    const apiKey = getApiKey();
    if (!apiKey) return;

    const voiceId = voiceIdManual.value.trim() || voiceSelect.value;
    const text = synthesizeText.value.trim();
    if (!voiceId) { showResult(synthesizeResult, '请选择或输入 voice_id', false); return; }
    if (!text)    { showResult(synthesizeResult, '请输入待合成文本', false); return; }

    setBtn(synthesizeBtn, true, '合成中…');
    showResult(synthesizeResult, '正在合成音频…');
    // 释放上一次的 blob URL
    if (audioPlayer.src && audioPlayer.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioPlayer.src);
    }

    try {
        const model = synthesizeModel.value.trim() || 'qwen3-tts-vc-2026-01-22';
        const resp = await fetch(`${API_BASE}/voice/synthesize`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({api_key: apiKey, voice_id: voiceId, text, model}),
        });

        if (!resp.ok) {
            let msg = resp.statusText;
            try { msg = (await resp.json()).error || msg; } catch (_) {}
            showResult(synthesizeResult, `合成失败：${msg}`, false);
            return;
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        audioPlayer.src = url;
        await audioPlayer.play();
        showResult(synthesizeResult,
            `✅ 合成完成（${(blob.size / 1024).toFixed(1)} KB），开始播放`);
    } catch (err) {
        showResult(synthesizeResult, `请求异常：${err}`, false);
    } finally {
        setBtn(synthesizeBtn, false, '实时合成');
    }
});

// ------------------------------------------------------------------
// 3. DeepSeek 语音对话
// ------------------------------------------------------------------
// 对话历史持久化到 localStorage（含纯文本与识图图片）；每条消息有唯一 id，
// 多会话聊天：会话与消息全部存 localStorage；每条 AI 消息合成音频单独缓存到
// IndexedDB（本地缓存，刷新后仍可回放）。数据仅存本浏览器，无服务器同步。
const SESSIONS_KEY = 'bluegsChatSessions';
const ACTIVE_SESSION_KEY = 'bluegsActiveSessionId';

function loadSessions() {
    try {
        const raw = localStorage.getItem(SESSIONS_KEY);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) return arr;
        }
    } catch (_) {}
    return [];
}
function saveSessions() {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(chatSessions)); } catch (_) {}
}
function saveActiveSessionId() {
    try { localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId); } catch (_) {}
}

let chatSessions = loadSessions();
if (!Array.isArray(chatSessions)) chatSessions = [];
let activeSessionId = localStorage.getItem(ACTIVE_SESSION_KEY) || '';

// 当前激活会话的消息列表
function currentMessages() {
    const s = chatSessions.find(x => x.id === activeSessionId);
    return s ? s.messages : [];
}
// 当前激活会话若已失效，回退到最近一个会话
function ensureActiveSession() {
    if (!chatSessions.length) return;
    if (!chatSessions.some(x => x.id === activeSessionId)) {
        activeSessionId = chatSessions[chatSessions.length - 1].id;
        saveActiveSessionId();
    }
}
function newSessionRecord(title) {
    return { id: nextMsgId(), title: title || '新对话', updatedAt: Date.now(), messages: [] };
}
function nextMsgId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ----- 本地音频缓存（IndexedDB）-----
const AUDIO_DB_NAME = 'bluegsVoiceCache';
const AUDIO_DB_STORE = 'audios';
let _audioDB = null;
function openAudioDB() {
    return new Promise((resolve, reject) => {
        if (_audioDB) return resolve(_audioDB);
        const req = indexedDB.open(AUDIO_DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(AUDIO_DB_STORE)) {
                req.result.createObjectStore(AUDIO_DB_STORE);
            }
        };
        req.onsuccess = () => { _audioDB = req.result; resolve(_audioDB); };
        req.onerror = () => reject(req.error);
    });
}
async function cacheAudio(id, blob) {
    try {
        const db = await openAudioDB();
        await new Promise((res, rej) => {
            const tx = db.transaction(AUDIO_DB_STORE, 'readwrite');
            tx.objectStore(AUDIO_DB_STORE).put(blob, id);
            tx.oncomplete = res;
            tx.onerror = () => rej(tx.error);
        });
    } catch (_) { /* 缓存失败不阻断播放 */ }
}
async function getCachedAudio(id) {
    try {
        const db = await openAudioDB();
        return await new Promise((res) => {
            const tx = db.transaction(AUDIO_DB_STORE, 'readonly');
            const rq = tx.objectStore(AUDIO_DB_STORE).get(id);
            rq.onsuccess = () => res(rq.result || null);
            rq.onerror = () => res(null);
        });
    } catch (_) { return null; }
}

let dsMuted = false;             // 静音开关

function fillDsKeySelect(keys) {
    const cur = dsKeySelect.value;
    dsKeySelect.innerHTML = '';
    if (!keys.length) {
        dsKeySelect.appendChild(new Option('— 暂无 —', ''));
        return;
    }
    dsKeySelect.appendChild(new Option('— 选择已保存的 Key —', ''));
    keys.forEach(k => {
        const mask = k.length > 12 ? `${k.slice(0,6)}…${k.slice(-4)}` : k;
        dsKeySelect.appendChild(new Option(mask, k));
    });
    if (cur) dsKeySelect.value = cur;
}

// DeepSeek Key 仅存浏览器本地（localStorage），不上传服务器
const LOCAL_DEEPSEEK_KEYS = 'bluegsDeepSeekKeys';
function loadLocalDsKeys() {
    try { return JSON.parse(localStorage.getItem(LOCAL_DEEPSEEK_KEYS) || '[]'); }
    catch (_) { return []; }
}
function saveLocalDsKey(k) {
    const arr = loadLocalDsKeys();
    if (!arr.includes(k)) arr.push(k);
    try { localStorage.setItem(LOCAL_DEEPSEEK_KEYS, JSON.stringify(arr)); } catch (_) {}
    return arr;
}

async function loadDsKeys() {
    fillDsKeySelect(loadLocalDsKeys());
}

dsLoadKeyBtn.addEventListener('click', () => {
    const k = dsKeySelect.value;
    if (!k) { dsKeyResult.textContent = '请先在下拉选择一个 Key'; return; }
    dsKey.value = k;
    dsKeyResult.textContent = '已载入';
});

dsSaveKeyBtn.addEventListener('click', async () => {
    const k = dsKey.value.trim();
    if (!k) { dsKeyResult.textContent = '当前 Key 为空'; return; }
    const keys = saveLocalDsKey(k);
    fillDsKeySelect(keys);
    dsKeySelect.value = k;
    dsKeyResult.textContent = '已保存（仅存本浏览器）';
});

// 头像：默认纯白圆，可上传替换（存 localStorage 持久化）
const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="#ffffff"/></svg>'
);
let userAvatar = localStorage.getItem('dsUserAvatar') || null;

function applyUserAvatar() {
    userAvatarImg.src = userAvatar || DEFAULT_AVATAR;
}
userAvatarImg.addEventListener('click', () => userAvatarFile.click());
userAvatarFile.addEventListener('change', () => {
    const f = userAvatarFile.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
        userAvatar = reader.result;
        try { localStorage.setItem('dsUserAvatar', userAvatar); } catch (_) {}
        applyUserAvatar();
    };
    reader.readAsDataURL(f);
});
applyUserAvatar();

// 渲染一条消息；返回 {bubble, playBtn, id}。
// 头像统一放第一子节点：CSS 中 msg-ai 为横排(row)，头像在左；
// msg-user 为 row-reverse，头像在最右 —— 因此顺序保持一致即可。
// AI 消息会在气泡下方附带一个"逐条播放"按钮（playBtn），用于回放该条本地缓存的语音。
function renderMsg(role, text, imageUrl, id) {
    const msgEl = document.createElement('div');
    msgEl.className = 'msg msg-' + role;
    msgEl.dataset.id = id || '';

    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.alt = role === 'user' ? '我' : 'AI';
    avatar.src = role === 'user' ? (userAvatar || DEFAULT_AVATAR) : DEFAULT_AVATAR;

    const msgBody = document.createElement('div');
    msgBody.className = 'msg-body';
    if (imageUrl) {
        const thumb = document.createElement('img');
        thumb.className = 'msg-img';
        thumb.src = imageUrl;
        thumb.alt = '图片';
        msgBody.appendChild(thumb);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = (id && currentMessages().find(m => m.id === id)?.time)
        || new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    actions.appendChild(time);
    let playBtn = null;
    if (role === 'ai') {
        playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'play-btn btn btn-mini';
        playBtn.dataset.id = id || '';
        playBtn.textContent = '▶ 播放';
        playBtn.addEventListener('click', () => playMsgAudio(playBtn, id));
        actions.appendChild(playBtn);
    }

    msgBody.appendChild(bubble);
    msgBody.appendChild(actions);

    msgEl.appendChild(avatar);    // 头像靠外：AI 左 / 用户右
    msgEl.appendChild(msgBody);

    chatThread.appendChild(msgEl);
    chatThread.scrollTop = chatThread.scrollHeight;
    return { bubble, playBtn, id };
}

// 识图：仅在选择识图模型时显示图片上传按钮。
const VISION_MODEL = 'deepseek-v4-flash-vision-exp';
let pendingImage = null;

function clearPendingImage() {
    pendingImage = null;
    dsImgPreview.hidden = true;
    dsImgPreviewImg.removeAttribute('src');
}

// 根据当前模型切换图片按钮显隐
function syncVisionUI() {
    const isVision = dsModel.value === VISION_MODEL;
    dsImageBtn.style.display = isVision ? '' : 'none';
    if (!isVision) clearPendingImage();
}

dsImageBtn.addEventListener('click', () => dsImageFile.click());
dsImageFile.addEventListener('change', () => {
    const f = dsImageFile.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
        pendingImage = reader.result;
        dsImgPreviewImg.src = pendingImage;
        dsImgPreview.hidden = false;
    };
    reader.readAsDataURL(f);
    dsImageFile.value = '';
});
dsImgRemove.addEventListener('click', clearPendingImage);
dsModel.addEventListener('change', syncVisionUI);
syncVisionUI();  // 初始按当前模型隐藏 / 显示

function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 96) + 'px';
}

// 把一段文本交给 /voice/synthesize 合成，返回音频 Blob（不直接播放）。
async function synthesizeBlob(text) {
    const dashKey = apiKeyEl.value.trim();
    const voiceId = voiceIdManual.value.trim() || voiceSelect.value;
    const ttsModel = synthesizeModel.value.trim() || 'qwen3-tts-vc-2026-01-22';
    if (!dashKey) throw new Error('请在“DashScope API Key”栏填入 Key');
    if (!voiceId) throw new Error('请在“语音合成”栏选择或输入音色');

    const resp = await fetch(`${API_BASE}/voice/synthesize`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({api_key: dashKey, voice_id: voiceId, text, model: ttsModel}),
    });
    if (!resp.ok) {
        let msg = resp.statusText;
        try { msg = (await resp.json()).error || msg; } catch (_) {}
        throw new Error('语音合成失败：' + msg);
    }
    return await resp.blob();
}

// 播放一段 Blob（复用聊天区隐藏的 audio 元素）
function playBlob(blob) {
    if (chatAudio.src && chatAudio.src.startsWith('blob:')) {
        URL.revokeObjectURL(chatAudio.src);
    }
    chatAudio.src = URL.createObjectURL(blob);
    return chatAudio.play().catch(() => {});
}

// 逐条播放：优先取本地缓存（IndexedDB），未缓存则实时合成并缓存到本地
async function playMsgAudio(btn, id) {
    const rec = currentMessages().find(m => m.id === id);
    if (!rec || !rec.content) { btn.textContent = '▶ 无文本'; return; }
    btn.disabled = true;
    btn.textContent = '⏳ 加载中…';
    let blob = await getCachedAudio(id);
    if (!blob) {
        try {
            btn.textContent = '⏳ 合成中…';
            blob = await synthesizeBlob(rec.content);
            await cacheAudio(id, blob);
        } catch (e) {
            btn.disabled = false;
            btn.textContent = '▶ 重试';
            return;
        }
    }
    btn.disabled = false;
    btn.textContent = '▶ 播放';
    await playBlob(blob);
}

function updateToken(u) {
    u = u || {};
    dsToken.textContent =
        `Tokens: 本轮 ${u.total_tokens ?? '—'}` +
        `（输入 ${u.prompt_tokens ?? '—'} / 输出 ${u.completion_tokens ?? '—'}）`;
}

// 流式：POST /api/chat/stream，逐字写入气泡，返回 {reply, usage}
async function streamChat(bubble, payload) {
    const resp = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: payload,
    });
    if (!resp.ok) {
        let msg = resp.statusText;
        try { msg = (await resp.json()).error || msg; } catch (_) {}
        throw new Error(msg);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '', reply = '', usage = null;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i).trim();
            buf = buf.slice(i + 2);
            const line = chunk.split('\n').find(l => l.trim().startsWith('data:'));
            if (!line) continue;
            let evt;
            try { evt = JSON.parse(line.trim().slice(5)); } catch (_) { continue; }
            if (evt.type === 'delta') {
                reply += evt.text || '';
                bubble.textContent = reply;
                chatThread.scrollTop = chatThread.scrollHeight;
            } else if (evt.type === 'usage') {
                usage = evt.usage;
            } else if (evt.type === 'error') {
                throw new Error(evt.message);
            }
        }
    }
    return { reply, usage };
}

async function sendChat() {
    const text = dsPrompt.value.trim();
    if (!text) return;
    const key = dsKey.value.trim();
    if (!key) {
        dsKeyResult.textContent = '请先填写 DeepSeek API Key';
        dsKey.focus();
        return;
    }

    // 用户消息：带唯一 id 的持久化记录，渲染后立即存档
    const userRec = {
        id: nextMsgId(),
        role: 'user',
        content: text,
        image: pendingImage || undefined,
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    };
    currentMessages().push(userRec);
    saveSessions();
    renderMsg('user', text, userRec.image, userRec.id);
    if (pendingImage) {
        pendingImage = null;
        dsImgPreview.hidden = true;
        dsImgPreviewImg.removeAttribute('src');
    }
    dsPrompt.value = '';
    autoGrow(dsPrompt);
    setBtn(dsSendBtn, true, '…');

    const model = dsModel.value || 'deepseek-v4-flash';
    const thinkingDisabled = !dsThink.checked;  // 勾选深度思考时则不关闭
    const stream = dsStream.checked;
    const toApi = (m) => (m.role === 'user' && m.image
        ? { role: 'user', content: [{ type: 'image_url', image_url: { url: m.image } }, { type: 'text', text: m.content }] }
        : { role: m.role, content: m.content });
    const history = currentMessages().slice(-30).map(toApi);
    const messages = (systemPrompt.trim()
        ? [{ role: 'system', content: systemPrompt.trim() }]
        : []).concat(history);
    const payload = JSON.stringify({
        api_key: key,
        model,
        thinking_disabled: thinkingDisabled,
        messages,
    });

    const assistantId = nextMsgId();
    const { bubble, playBtn } = renderMsg('ai', stream ? '' : '…', null, assistantId);
    let reply = '', usage = null;

    try {
        if (stream) {
            const out = await streamChat(bubble, payload);
            reply = (out.reply || '').trim();
            usage = out.usage;
        } else {
            const resp = await fetch(`${API_BASE}/chat/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
            });
            const data = await safeJson(resp);
            if (!resp.ok || !data) {
                throw new Error((data && data.error) || `${resp.status} ${resp.statusText}`);
            }
            reply = (data.reply || '').trim();
            usage = data.usage;
            bubble.textContent = reply;
        }

        if (!reply) throw new Error('返回内容为空');

        const assistantRec = {
            id: assistantId,
            role: 'assistant',
            content: reply,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        };
        currentMessages().push(assistantRec);
        saveSessions();
        updateSessionTitle(activeSessionId);   // 首条用户消息自动命名
        updateToken(usage);

        // 未静音：自动合成语音并缓存到本地，播放按钮即可随时回放
        if (!dsMuted && playBtn) {
            playBtn.textContent = '⏳ 合成中…';
            playBtn.disabled = true;
            try {
                const blob = await synthesizeBlob(reply);
                await cacheAudio(assistantId, blob);
                playBtn.textContent = '▶ 播放';
                playBtn.disabled = false;
                await playBlob(blob);
            } catch (e) {
                playBtn.textContent = '▶ 生成语音';
                playBtn.disabled = false;
                dsToken.textContent += '；' + e.message;
            }
        } else if (playBtn) {
            // 静音：本回合未自动合成，点击播放按钮时按需生成
            playBtn.textContent = '▶ 生成语音';
        }
    } catch (err) {
        bubble.textContent = `（请求失败：${err.message}）`;
        // 回滚这条 user 消息
        currentMessages().pop();
        saveSessions();
    } finally {
        setBtn(dsSendBtn, false, '发送');
    }
}

dsSendBtn.addEventListener('click', sendChat);
dsPrompt.addEventListener('input', () => autoGrow(dsPrompt));
dsPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

dsMuteBtn.addEventListener('click', () => {
    dsMuted = !dsMuted;
    dsMuteBtn.textContent = dsMuted ? '🔊 取消静音' : '🔇 静音';
    if (dsMuted) chatAudio.pause();
});

// 启动时拉取已保存的 DeepSeek Key
loadDsKeys();

// ------------------------------------------------------------------
// 设置弹窗开合
// ------------------------------------------------------------------
settingsBtn.addEventListener('click', () => { settingsModal.hidden = false; });
settingsCloseBtn.addEventListener('click', () => { settingsModal.hidden = true; });
settingsModal.addEventListener('click', (e) => {   // 点击遮罩空白处关闭
    if (e.target === settingsModal) settingsModal.hidden = true;
});

// ------------------------------------------------------------------
// 使用文档弹窗
// ------------------------------------------------------------------
const docsBtn      = $('docsBtn');
const docsModal    = $('docsModal');
const docsCloseBtn = $('docsCloseBtn');
docsBtn.addEventListener('click', () => { docsModal.hidden = false; });
docsCloseBtn.addEventListener('click', () => { docsModal.hidden = true; });
docsModal.addEventListener('click', (e) => {   // 点击遮罩空白处关闭
    if (e.target === docsModal) docsModal.hidden = true;
});

// ------------------------------------------------------------------
// 初始提示词（仅存本浏览器 localStorage，发送时作为 system 消息）
// ------------------------------------------------------------------
const LOCAL_SYSTEM_PROMPT = 'bluegsSystemPrompt';
let systemPrompt = '';

function loadSystemPrompt() {
    systemPrompt = (localStorage.getItem(LOCAL_SYSTEM_PROMPT) || '').trim();
    dsSystemPrompt.value = systemPrompt;
}

dsSystemPromptSave.addEventListener('click', () => {
    const prompt = (dsSystemPrompt.value || '').trim();
    systemPrompt = prompt;
    try { localStorage.setItem(LOCAL_SYSTEM_PROMPT, prompt); } catch (_) {}
    dsSystemPromptResult.textContent = '已保存（仅存本浏览器）';
});

// ------------------------------------------------------------------
// 预设项目（绑定 QwenTTS Key + DeepSeek Key + voice_id + 合成模型 + 提示词）
// 与激活预设均只存本浏览器 localStorage，不上传服务器。
// ------------------------------------------------------------------
const LOCAL_PRESETS = 'bluegsPresets';
const LOCAL_ACTIVE_PRESET = 'bluegsActivePreset';
function loadLocalPresets() {
    try { return JSON.parse(localStorage.getItem(LOCAL_PRESETS) || '[]'); }
    catch (_) { return []; }
}
function saveLocalPresets(presets) {
    try { localStorage.setItem(LOCAL_PRESETS, JSON.stringify(presets)); } catch (_) {}
}

function currentPresetPayload() {
    return {
        qwen_key: apiKeyEl.value.trim(),
        deepseek_key: dsKey.value.trim(),
        voice_id: voiceIdManual.value.trim() || voiceSelect.value,
        voice_name: voiceSelect.selectedOptions[0]
            ? voiceSelect.selectedOptions[0].textContent.split('(')[0].trim() : '',
        tts_model: synthesizeModel.value.trim(),
        system_prompt: dsSystemPrompt.value.trim(),
    };
}

function fillPresetSelect(presets) {
    const cur = presetSelect.value;
    presetSelect.innerHTML = '';
    if (!presets.length) {
        presetSelect.appendChild(new Option('— 暂无预设 —', ''));
        return;
    }
    presetSelect.appendChild(new Option('— 选择预设 —', ''));
    presets.forEach(p => presetSelect.appendChild(new Option(p.name, p.name)));
    if (cur) presetSelect.value = cur;
}

function loadPresets() {
    fillPresetSelect(loadLocalPresets());
}

presetSaveBtn.addEventListener('click', () => {
    const name = presetName.value.trim();
    if (!name) { presetResult.textContent = '请先填写预设名称'; return; }
    const presets = loadLocalPresets();
    const idx = presets.findIndex(x => x.name === name);
    const payload = Object.assign({ name }, currentPresetPayload());
    if (idx >= 0) presets[idx] = payload; else presets.push(payload);
    saveLocalPresets(presets);
    fillPresetSelect(presets);
    presetSelect.value = name;
    setActivePreset(name);   // 保存即设为激活
    presetResult.textContent = `已保存预设「${name}」（仅存本浏览器）`;
});

// 把预设内容应用到各输入框（含提示词）
function applyPreset(p) {
    apiKeyEl.value = p.qwen_key || '';
    dsKey.value = p.deepseek_key || '';
    voiceIdManual.value = p.voice_id || '';
    voiceSelect.value = p.voice_id || '';
    synthesizeModel.value = p.tts_model || '';
    if (p.system_prompt) {
        dsSystemPrompt.value = p.system_prompt;
        systemPrompt = p.system_prompt.trim();
        // 同步到独立提示词槽，保证刷新后激活预设的提示词生效（单一来源）
        try { localStorage.setItem(LOCAL_SYSTEM_PROMPT, systemPrompt); } catch (_) {}
    }
}

// 把某个预设记为浏览器本地的激活预设
function setActivePreset(name) {
    try { localStorage.setItem(LOCAL_ACTIVE_PRESET, name || ''); } catch (_) {}
}

presetLoadBtn.addEventListener('click', () => {
    const name = presetSelect.value;
    if (!name) { presetResult.textContent = '请先选择一个预设'; return; }
    const p = loadLocalPresets().find(x => x.name === name);
    if (!p) { presetResult.textContent = '预设不存在'; return; }
    applyPreset(p);
    presetSelect.value = name;
    setActivePreset(name);   // 记住为当前激活预设
    presetResult.innerHTML = `<span class="ok">已载入并设为激活「${name}」</span>`;
});

presetDeleteBtn.addEventListener('click', () => {
    const name = presetSelect.value;
    if (!name) { presetResult.textContent = '请先选择一个预设'; return; }
    const presets = loadLocalPresets().filter(x => x.name !== name);
    saveLocalPresets(presets);
    fillPresetSelect(presets);
    presetName.value = name;
    presetResult.textContent = `已删除「${name}」`;
    if (localStorage.getItem(LOCAL_ACTIVE_PRESET) === name) setActivePreset('');
});

// ------------------------------------------------------------------
// 聊天历史恢复：刷新/重开后重建消息气泡；AI 消息异步检测本地音频缓存
// 以决定播放按钮的状态（有缓存 → 直接回放；无缓存 → 点击实时合成）
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// 多会话（类 DeepSeek 网页端）：会话独立存储，可切换继续、可随时新开聊天。
// ------------------------------------------------------------------
// 渲染当前激活会话的全部消息；AI 消息异步检测本地音频缓存以决定播放按钮状态
function renderActiveSession() {
    chatThread.innerHTML = '';
    currentMessages().forEach((rec) => {
        const { playBtn, id } = renderMsg(rec.role, rec.content, rec.image, rec.id);
        if (playBtn) {
            void getCachedAudio(id).then((blob) => {
                if (blob && playBtn) playBtn.textContent = '播放';
            });
        }
    });
}

// 会话列表：每个会话一个 chip（点击切换）+ ✎ 重命名按钮，激活态高亮
function renderSessionList() {
    const wrap = $('sessionList');
    if (!wrap) return;
    wrap.innerHTML = '';
    chatSessions.forEach((s) => {
        const item = document.createElement('div');
        item.className = 'session-item' + (s.id === activeSessionId ? ' active' : '');

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'session-chip';
        chip.textContent = s.title || '新对话';
        chip.title = s.title || '新对话';
        chip.addEventListener('click', () => switchSession(s.id));

        const rn = document.createElement('button');
        rn.type = 'button';
        rn.className = 'session-rename';
        rn.textContent = '🖊';
        rn.title = '重命名会话';
        rn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = prompt('重命名会话：', s.title || '');
            if (name === null) return;
            const t = name.trim();
            if (!t) return;
            s.title = t;
            s.updatedAt = Date.now();
            saveSessions();
            renderSessionList();
        });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'session-rename session-del';
        del.textContent = 'x';
        del.title = '删除会话';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm(`确认删除「${s.title || '新对话'}」？`)) return;
            const idx = chatSessions.indexOf(s);
            if (idx >= 0) chatSessions.splice(idx, 1);
            if (activeSessionId === s.id) {
                // 删除的是激活会话：切到最近一个；若已无会话则新开一个
                const next = chatSessions[chatSessions.length - 1];
                if (next) {
                    activeSessionId = next.id;
                } else {
                    const fresh = newSessionRecord('新对话');
                    chatSessions.push(fresh);
                    activeSessionId = fresh.id;
                }
                renderActiveSession();
            }
            saveSessions();
            saveActiveSessionId();
            renderSessionList();
        });

        item.appendChild(chip);
        item.appendChild(rn);
        item.appendChild(del);
        wrap.appendChild(item);
    });
}

function switchSession(id) {
    if (id === activeSessionId) return;
    activeSessionId = id;
    saveActiveSessionId();
    renderSessionList();
    renderActiveSession();
}

// 新开会话并切过去
function newSession() {
    const s = newSessionRecord('新对话');
    chatSessions.push(s);
    activeSessionId = s.id;
    saveSessions();
    saveActiveSessionId();
    chatThread.innerHTML = '';
    renderSessionList();
    dsToken.textContent = 'Tokens: —';
}

// 根据会话首条用户消息自动生成标题
function updateSessionTitle(sessionId) {
    const s = chatSessions.find(x => x.id === sessionId);
    if (!s) return;
    const firstUser = s.messages.find(m => m.role === 'user');
    const t = firstUser && firstUser.content ? firstUser.content.replace(/\s+/g, ' ').trim() : '';
    s.title = t ? (t.length > 14 ? t.slice(0, 14) + '…' : t) : '新对话';
    s.updatedAt = Date.now();
    saveSessions();
    renderSessionList();
}

// 把旧版单会话历史（bluegsChatHistoryV2）迁移为第一个会话（仅首次）
function migrateLegacyHistory() {
    try {
        const raw = localStorage.getItem('bluegsChatHistoryV2');
        if (!raw || chatSessions.length) return;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr) || !arr.length) return;
        const s = newSessionRecord('历史会话');
        s.messages = arr.filter(m => m && m.role && (m.role === 'user' || m.role === 'assistant'));
        chatSessions.push(s);
        activeSessionId = s.id;
        saveSessions();
        saveActiveSessionId();
        localStorage.removeItem('bluegsChatHistoryV2');
    } catch (_) {}
}

// 启动初始化会话：先迁移旧历史，随后每次进入网页默认开一个全新空会话。
// 若最近一个会话仍是空会话则复用，避免每次刷新都堆积空的"新对话"。
function initSessions() {
    migrateLegacyHistory();
    const last = chatSessions[chatSessions.length - 1];
    if (last && last.messages && last.messages.length === 0) {
        activeSessionId = last.id;     // 复用最近这个空会话作为入口
    } else {
        const s = newSessionRecord('新对话');  // 默认新开
        chatSessions.push(s);
        activeSessionId = s.id;
        saveSessions();
    }
    saveActiveSessionId();
}

// 事件委托绑定"新对话"：绑定在 document 上，无论元素何时出现都能命中
document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('#newChatBtn')) newSession();
});

// 启动：初始化本地会话 -> 渲染会话列表与当前会话 -> 加载本地 Key/预设/提示词。
// 用 try/catch 包裹：任一初始化异常都不应影响后续已绑定的事件。
try { initSessions(); } catch (_) {}
try {
    renderSessionList();
    renderActiveSession();
} catch (_) {}
try { loadPresets(); } catch (_) {}
try { loadSystemPrompt(); } catch (_) {}
try { loadActivePreset(); } catch (_) {}
try { loadPromptWriterSystem(); } catch (_) {}
try { loadApiKeys(); } catch (_) {}
try { loadDsKeys(); } catch (_) {}

// ------------------------------------------------------------------
// 让 DeepSeek 编写角色提示词并自动填入应用
// ------------------------------------------------------------------
// 系统指令自 promptWriterSystem.txt 拉取（可被用户编辑）；拉取失败用内置兜底
const PROMPT_WRITER_SYSTEM_FALLBACK =
    '你是一名专业的提示词（Prompt）设计师。用户会描述一个角色，请据此编写一段 Markdown 格式的' +
    '系统提示词，用于让另一个 AI 在对话中完全模仿该角色的性格、语气、口头禅和行为方式。' +
    '要求：直接输出 Markdown 提示词正文即可，不要任何前言、解释或结尾语。';
let promptWriterSystem = PROMPT_WRITER_SYSTEM_FALLBACK;

async function loadPromptWriterSystem() {
    try {
        const resp = await fetch(`${API_BASE}/settings/prompt-writer/system`);
        const data = await safeJson(resp);
        if (resp.ok && data && data.content && data.content.trim()) {
            promptWriterSystem = data.content.trim();
        }
    } catch (_) { /* 保持兜底文案 */ }
}

dsPromptAiBtn.addEventListener('click', async () => {
    const key = dsKey.value.trim();
    const desc = roleDesc.value.trim();
    if (!key) { dsPromptAiResult.textContent = '请先在设置中填写 DeepSeek API Key'; return; }
    if (!desc) { dsPromptAiResult.textContent = '请先描述一个角色'; roleDesc.focus(); return; }

    setBtn(dsPromptAiBtn, true, '编写中…');
    dsPromptAiResult.innerHTML = '';
    try {
        const payload = JSON.stringify({
            api_key: key,
            model: 'deepseek-v4-flash',          // 固定用 flash 编写
            thinking_disabled: true,
            messages: [
                { role: 'system', content: promptWriterSystem },
                { role: 'user', content: desc },
            ],
        });
        const resp = await fetch(`${API_BASE}/chat/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
        });
        const data = await safeJson(resp);
        if (!resp.ok || !data) {
            throw new Error((data && data.error) || `${resp.status} ${resp.statusText}`);
        }
        const prompt = (data.reply || '').trim();
        if (!prompt) throw new Error('返回内容为空');

        // 自动填入并应用（不落盘，用户可随后点击“保存提示词”）
        dsSystemPrompt.value = prompt;
        systemPrompt = prompt;
        dsPromptAiResult.innerHTML =
            `<span class="ok">已生成并应用（${prompt.length} 字）。可点击上方“保存提示词”落盘。</span>`;
    } catch (e) {
        dsPromptAiResult.innerHTML = `<span class="err">失败：${e.message}</span>`;
    } finally {
        setBtn(dsPromptAiBtn, false, '✨ 让 DeepSeek 编写并应用');
    }
});

// 自动应用中选中的激活预设（仅读浏览器本地 bluegsActivePreset）
function loadActivePreset() {
    try {
        const name = localStorage.getItem(LOCAL_ACTIVE_PRESET) || '';
        if (!name) return;
        const p = loadLocalPresets().find(x => x.name === name);
        if (p) {
            applyPreset(p);
            if (presetSelect) presetSelect.value = name;
        }
    } catch (_) {}
}
