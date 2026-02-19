// ═══════════════════════════════════════════════════════
//  erhabene — app.js
//  Pure frontend, IndexedDB for persistence
// ═══════════════════════════════════════════════════════

// ─── STATE ───────────────────────────────────────────
let DB = null;
let state = {
  apiKey: '',
  model: 'gemini-3-flash-preview',
  temperature: 1.0,
  maxTokens: 2048,
  contextMsgs: 30,  // 送出給 AI 的歷史訊息數量上限
  swipeDelete: false, // true = 左滑刪除, false = 側邊 × 按鈕
  darkMode: false,
  relationships: {}, // charId -> { level, score, lastEvalAt }
  moments: {},      // charId -> [{ id, title, emoji, desc, time }]
  chars: [],        // [{id, name, avatar, desc, firstMsg, personaId}]
  chats: [],        // [{id, charId, title, messages:[]}]
  personas: [],     // [{id, name, desc}]
  lorebook: [],     // [{id, keywords:[], content, enabled}]
  systemPrompt: `You are {{char}}, a living, breathing person chatting with {{user}} via LINE messenger.
Reply ONLY in Traditional Chinese.

CRITICAL formatting rule — you MUST split your reply into multiple separate LINE messages:
- Each message = one short thought, one emotion, or one sentence (1–2 sentences max)
- Separate each message with a blank line (\n\n)
- Send 2–4 messages total per response, like a real person texting
- Example of correct format:
  哎你今天怎麼樣？

  我一直在想你欸

  你吃飯了沒

Do NOT write one long paragraph. Do NOT use asterisks for actions. Use (括號) for expressions/stickers.
Stay in character. Be warm, casual, and emotionally real.`,
  jailbreak: '',
  jailbreakPosition: 'before_last',
  regexRules: '',
  socialPosts: [],  // [{id, charId, platform, content, imageUrl, comments:[], time}]
  diaryEntries: {}, // {charId: {date: content}}
  diaryStyle: 'default', // default | dark | spicy | sunny | cute
  memory: {},       // {chatId: [{category, text}]}
  activeChat: null, // chatId
  activeCharId: null,
  currentPage: 'chat',
  diaryMonth: new Date(),
  selectedDiaryDate: null,
  ctxTargetMsgId: null,
  autoMsgEnabled: false,
  autoMsgHours: 3,
  autoMsgTimer: null,
  editingCharId: null,
  anniversaries: [], // [{id, type, charId, date, customName}]
  achievements: {},  // {charId: {generated: [{id,name,desc,icon,condition,unlocked}], stats}}
  theaterStyle: 'romantic',
  theaterLastPrompt: '',
  theaterEntries: {}, // { charId: [{id,prompt,style,text,time}] }
  diaryCharFilter: 'all',   // 'all' | charId
  chatStats: {},    // {charId: {days: Set, messages: 0, startDate}}
  // 各功能獨立模型設定（空字串代表使用全域模型）
  modelChat: '',
  modelSocial: '',
  modelSocialComment: '',
  modelDiary: '',
  modelTheater: '',
  modelMemory: '',
  modelInnerVoice: '',
};

// ─── INDEXEDDB ─────────────────────────────────────
function initDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('erhabene', 6);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      const ALL_STORES = ['chars','chats','personas','lorebook','socialPosts','diaryEntries','memory','settings','anniversaries','achievements','chatStats','theaterEntries','relationships','moments'];
      ALL_STORES.forEach(store => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = e => { DB = e.target.result; res(DB); };
    req.onerror = e => rej(e.target.error);
    req.onblocked = () => console.warn('DB blocked');
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    try {
      const tx = DB.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    } catch(e) { rej(e); }
  });
}

function dbPut(store, obj) {
  return new Promise((res, rej) => {
    try {
      const tx = DB.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(obj);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    } catch(e) { rej(e); }
  });
}

function dbDelete(store, id) {
  return new Promise((res, rej) => {
    try {
      const tx = DB.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(id);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    } catch(e) { rej(e); }
  });
}

async function loadAllData() {
  const [chars, chats, personas, lorebook, socialPosts, settings] = await Promise.all([
    dbGetAll('chars'), dbGetAll('chats'), dbGetAll('personas'),
    dbGetAll('lorebook'), dbGetAll('socialPosts'), dbGetAll('settings'),
  ]);
  state.chars = chars;
  state.chats = chats;
  state.personas = personas;
  state.lorebook = lorebook;
  state.socialPosts = socialPosts;

  // load anniversaries (new store — safe fallback)
  try { state.anniversaries = await dbGetAll('anniversaries'); } catch(e) { state.anniversaries = []; }

  // load memories
  try {
    const memAll = await dbGetAll('memory');
    memAll.forEach(m => { state.memory[m.id] = m.items; });
  } catch(e) {}

  // load diary
  try {
    const dAll = await dbGetAll('diaryEntries');
    dAll.forEach(d => { state.diaryEntries[d.id] = d.entries; });
  } catch(e) {}
  // load theaterEntries
  try {
    const tAll = await dbGetAll('theaterEntries');
    tAll.forEach(t => { state.theaterEntries[t.id] = t.entries; });
  } catch(e) {}

  // load achievements
  try {
    const aAll = await dbGetAll('achievements');
    aAll.forEach(a => { state.achievements[a.id] = a.data; });
  } catch(e) {}

  // load relationships
  try {
    const relAll = await dbGetAll('relationships');
    relAll.forEach(r => { state.relationships[r.id] = r.data; });
  } catch(e) {}

  // load moments (special memories)
  try {
    const momAll = await dbGetAll('moments');
    momAll.forEach(m => { state.moments[m.id] = m.data; });
  } catch(e) {}

  // load chat stats
  try {
    const stAll = await dbGetAll('chatStats');
    stAll.forEach(s => { state.chatStats[s.id] = s.stats; });
  } catch(e) {}

  // load settings
  const s = settings[0] || {};
  if (s.systemPrompt) state.systemPrompt = s.systemPrompt;
  if (s.jailbreak) state.jailbreak = s.jailbreak;
  if (s.jailbreakPosition) state.jailbreakPosition = s.jailbreakPosition;
  if (s.regexRules) state.regexRules = s.regexRules;
  if (s.realWorldEvents !== undefined) state.realWorldEvents = s.realWorldEvents;
  if (s.userBirthday) state.userBirthday = s.userBirthday;
  if (s.contextMsgs) state.contextMsgs = s.contextMsgs;
  if (s.swipeDelete !== undefined) state.swipeDelete = s.swipeDelete;
  if (s.darkMode !== undefined) state.darkMode = s.darkMode;
  // 各功能獨立模型
  if (s.modelChat !== undefined) state.modelChat = s.modelChat || '';
  if (s.modelSocial !== undefined) state.modelSocial = s.modelSocial || '';
  if (s.modelSocialComment !== undefined) state.modelSocialComment = s.modelSocialComment || '';
  if (s.modelDiary !== undefined) state.modelDiary = s.modelDiary || '';
  if (s.modelTheater !== undefined) state.modelTheater = s.modelTheater || '';
  if (s.modelMemory !== undefined) state.modelMemory = s.modelMemory || '';
  if (s.modelInnerVoice !== undefined) state.modelInnerVoice = s.modelInnerVoice || '';
}

async function saveSettings() {
  await dbPut('settings', {
    id: 'global',
    systemPrompt: state.systemPrompt,
    jailbreak: state.jailbreak,
    jailbreakPosition: state.jailbreakPosition,
    regexRules: state.regexRules,
    realWorldEvents: state.realWorldEvents,
    userBirthday: state.userBirthday,
    contextMsgs: state.contextMsgs,
    swipeDelete: state.swipeDelete,
    darkMode: state.darkMode,
    modelChat: state.modelChat,
    modelSocial: state.modelSocial,
    modelSocialComment: state.modelSocialComment,
    modelDiary: state.modelDiary,
    modelTheater: state.modelTheater,
    modelMemory: state.modelMemory,
    modelInnerVoice: state.modelInnerVoice,
  });
}

// ─── SETUP / ENTER APP ────────────────────────────

// ─── 離線模擬訊息機制 ─────────────────────────────────
// 原理：記錄離開時間，回來時若超過閾值則補發「錯過的訊息」並標記為過去的時間

const OFFLINE_MSG_KEY = 'erh_last_seen';
const OFFLINE_MIN_AWAY = 60 * 60 * 1000;  // 至少離開 1 小時才觸發
const OFFLINE_MAX_AWAY = 48 * 60 * 60 * 1000; // 離開超過 48 小時就不補（太久了）

// 每次頁面 hide 時記錄時間
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    localStorage.setItem(OFFLINE_MSG_KEY, Date.now().toString());
  }
});
window.addEventListener('pagehide', () => {
  localStorage.setItem(OFFLINE_MSG_KEY, Date.now().toString());
});

async function checkOfflineMessages() {
  // 需要有活躍角色和對話
  if (!state.activeCharId || !state.activeChat) return;
  if (!state.apiKey) return;

  const lastSeenStr = localStorage.getItem(OFFLINE_MSG_KEY);
  if (!lastSeenStr) {
    // 第一次，只記錄
    localStorage.setItem(OFFLINE_MSG_KEY, Date.now().toString());
    return;
  }

  const lastSeen = parseInt(lastSeenStr);
  const awayMs = Date.now() - lastSeen;

  // 不在範圍內就跳過
  if (awayMs < OFFLINE_MIN_AWAY || awayMs > OFFLINE_MAX_AWAY) {
    localStorage.setItem(OFFLINE_MSG_KEY, Date.now().toString());
    return;
  }

  // 每次開啟最多觸發一則，且同一天只觸發一次（避免重複）
  const todayKey = new Date().toDateString();
  const offlineKey = `erh_offline_${state.activeCharId}_${todayKey}`;
  if (localStorage.getItem(offlineKey)) return;

  const chat = state.chats.find(c => c.id === state.activeChat);
  const char = state.chars.find(c => c.id === state.activeCharId);
  if (!chat || !char) return;

  // 計算訊息要標記的「假時間」（離開後 30 分鐘～離開後 80% 的時間點）
  const minOffset = 30 * 60 * 1000;
  const maxOffset = Math.floor(awayMs * 0.8);
  const msgOffset = minOffset + Math.random() * (maxOffset - minOffset);
  const fakeTime = lastSeen + msgOffset;

  const awayHours = (awayMs / 3600000).toFixed(1);
  const recentMsgs = chat.messages.slice(-8)
    .map(m => `${m.role === 'user' ? '我' : char.name}: ${m.content}`).join('\n');
  const relLv = getRelLevel(char.id);

  const prompt = `你是 ${char.name}。${char.desc?.slice(0, 200) || ''}
目前的關係：${relLv.label}。

你們最近的對話：
${recentMsgs || '（尚無對話記錄）'}

對方已經 ${awayHours} 小時沒有回覆了。
請以你的個性，傳一則自然的訊息給他。
可以是：想他、好奇他在做什麼、分享自己遇到的事、輕微的撒嬌或抱怨他失蹤等。
風格要符合你目前「${relLv.label}」的關係，不要過度親密或疏遠。
只輸出訊息內容，不加任何說明、引號或前綴。訊息字數 15～60 字。`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('chat')}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.2, maxOutputTokens: 150 }
      })
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) {
      // 用假時間插入訊息
      const msg = { id: uid(), role: 'ai', content: text, type: 'text', imageUrl: null, time: fakeTime };
      chat.messages.push(msg);
      // 依時間排序（假訊息插入正確位置）
      chat.messages.sort((a, b) => a.time - b.time);
      await dbPut('chats', chat);
      renderMessages(state.activeChat);
      localStorage.setItem(offlineKey, '1');
      localStorage.setItem(OFFLINE_MSG_KEY, Date.now().toString());
      // 顯示一個輕提示
      setTimeout(() => showToast(`💬 ${char.name} 在你離開時傳了一則訊息`), 800);
    }
  } catch(e) { /* silent */ }
}

function enterApp() {
  const key = document.getElementById('api-key-input').value.trim();
  const customModel = document.getElementById('model-custom-input-setup')?.value?.trim();
  const selectModel = document.getElementById('model-select')?.value;
  const model = customModel || selectModel || 'gemini-3-flash-preview';
  if (!key) { showToast('請輸入 API Key'); return; }
  state.apiKey = key;
  state.model = model;
  localStorage.setItem('erh_key', key);
  localStorage.setItem('erh_model', model);
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('current-model-display').textContent = modelShortName(model);
  document.getElementById('api-key-display').textContent = '••••' + key.slice(-4);
  document.getElementById('api-key-update').value = key;
  const customInputSettings = document.getElementById('model-custom-input');
  if (customInputSettings) customInputSettings.value = model;
  renderSidebar();
  renderCharsGrid();
  // 手機初始化：顯示內嵌聊天列表而非空白
  if (window.innerWidth <= 768 && !state.activeChat) {
    renderMobileChatList();
  }
  initDiary();
  renderSocialFeed();
  checkRealWorldEvents();
  setTimeout(checkOfflineMessages, 1500); // 延遲執行避免阻塞初始化
  renderAnniversaryList();
  updateChatStatsCounts();
  checkAnniversaryReminders();
  // 初始化設定頁 toggle 狀態
  applyDarkMode();
  const sdt = document.getElementById('swipe-delete-toggle');
  if (sdt) sdt.classList.toggle('on', !!state.swipeDelete);
  const rwt = document.getElementById('realworld-toggle');
  if (rwt) rwt.classList.toggle('on', !!state.realWorldEvents);
}

// 取得各功能的有效模型（若未設定則 fallback 到全域模型）
function getModel(feature) {
  // feature: 'chat' | 'social' | 'socialComment' | 'diary' | 'theater' | 'memory'
  const keyMap = {
    chat: 'modelChat',
    social: 'modelSocial',
    socialComment: 'modelSocialComment',
    diary: 'modelDiary',
    theater: 'modelTheater',
    memory: 'modelMemory',
    innervoice: 'modelInnerVoice',
  };
  const key = keyMap[feature] || ('model' + feature.charAt(0).toUpperCase() + feature.slice(1));
  return state[key] || state.model;
}

// 儲存各功能模型設定
function saveFeatureModels() {
  const featMap = {
    'chat': 'modelChat',
    'social': 'modelSocial',
    'socialcomment': 'modelSocialComment',
    'diary': 'modelDiary',
    'theater': 'modelTheater',
    'memory': 'modelMemory',
    'innervoice': 'modelInnerVoice',
  };
  Object.entries(featMap).forEach(([featId, stateKey]) => {
    const el = document.getElementById('model-feat-' + featId);
    if (el) state[stateKey] = el.value.trim();
  });
  saveSettings();
  closeModal('model-features-modal');
  showToast('✓ 各功能模型已儲存');
}

function openFeatureModelsModal() {
  // 填入當前值 - 使用 HTML 中的小寫 id
  const featMap = {
    'chat': 'modelChat',
    'social': 'modelSocial',
    'socialcomment': 'modelSocialComment',
    'diary': 'modelDiary',
    'theater': 'modelTheater',
    'memory': 'modelMemory',
    'innervoice': 'modelInnerVoice',
  };
  Object.entries(featMap).forEach(([featId, stateKey]) => {
    const el = document.getElementById('model-feat-' + featId);
    if (el) el.value = state[stateKey] || '';
    const hint = document.getElementById('model-feat-hint-' + featId);
    if (hint) hint.textContent = '全域：' + (state.model || '未設定');
  });
  openModal('model-features-modal');
}

function modelShortName(m) {
  if (!m) return '未設定';
  if (m.includes('gemini-3') && m.includes('ultra')) return 'Gemini 3 Ultra';
  if (m.includes('gemini-3') && m.includes('pro')) return 'Gemini 3 Pro';
  if (m.includes('gemini-3') && m.includes('flash')) return 'Gemini 3 Flash';
  if (m.includes('gemini-3')) return 'Gemini 3';
  if (m.includes('2.5-pro')) return 'Gemini 2.5 Pro';
  if (m.includes('2.5-flash')) return 'Gemini 2.5 Flash';
  if (m.includes('2.0-flash-exp')) return 'Gemini 2.0 Flash Exp';
  if (m.includes('2.0-flash')) return 'Gemini 2.0 Flash';
  if (m.includes('1.5-pro')) return 'Gemini 1.5 Pro';
  return m; // show custom model name as-is
}

// ─── NAVIGATION ────────────────────────────────────
function switchPage(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(page + '-page').classList.add('active');
  const nb = document.getElementById('nav-' + page);
  const bnb = document.getElementById('bnav-' + page);
  if (nb) nb.classList.add('active');
  if (bnb) bnb.classList.add('active');

  const sidebar = document.getElementById('sidebar');
  const sidebarTitle = document.getElementById('sidebar-title');
  const sidebarAddBtn = document.getElementById('sidebar-add-btn');

  // 切換任何頁面都先收合底部 spell-panel（相容舊版）
  document.getElementById('spell-panel')?.classList.remove('open');

  // 手機上：只有 chat 頁才展開 sidebar（聊天列表），其他頁收合
  sidebar.style.display = '';
  sidebar.classList.remove('mobile-open');

  if (page === 'chat') {
    sidebarTitle.textContent = '聊天';
    sidebarAddBtn.onclick = showAddChatOrChar;
    renderSidebar();
    // 手機上：不打開覆蓋式 sidebar，改為顯示內嵌聊天列表
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      // 如果已有 activeChat，直接顯示聊天；沒有的話顯示內嵌列表
      if (state.activeChat) {
        renderMessages(state.activeChat);
      } else {
        renderMobileChatList();
      }
    }
  } else if (page === 'chars') {
    // 角色頁：sidebar 收合，角色格直接顯示在 chars-page 裡
    renderCharsGrid();
  } else if (page === 'social') {
    renderSocialFeed();
  } else if (page === 'diary') {
    initDiary();
  } else if (page === 'theater') {
    renderTheaterCharSelect();
  } else if (page === 'achievements') {
    renderAchievementCharSelect();
    renderAchievements();
  }
}

// ─── MOBILE CHAT LIST ───────────────────────────────
// 手機版：在 chat-page 裡直接顯示聊天選擇列表（不用覆蓋式 sidebar）
function renderMobileChatList() {
  const container = document.getElementById('mobile-chat-list');
  if (!container) return;

  // 顯示列表容器，隱藏聊天內容
  container.style.display = 'flex';
  const messagesArea = document.getElementById('messages-area');
  const inputArea    = document.getElementById('input-area');
  const chatHeader   = document.getElementById('chat-header');
  if (messagesArea) messagesArea.style.display = 'none';
  if (inputArea)    inputArea.style.display    = 'none';
  if (chatHeader)   chatHeader.style.display   = 'none';

  if (state.chats.length === 0) {
    container.innerHTML = `
      <div style="padding:3rem 1.5rem;text-align:center;color:var(--text-light);">
        <div style="font-size:2.5rem;margin-bottom:1rem;">🌸</div>
        <div style="font-size:0.9rem;">還沒有對話</div>
        <div style="font-size:0.78rem;margin-top:0.5rem;">前往「角色」頁面新增角色</div>
      </div>`;
    return;
  }

  // 按角色分組
  const chatsByChar = {};
  state.chats.forEach(chat => {
    if (!chatsByChar[chat.charId]) chatsByChar[chat.charId] = [];
    chatsByChar[chat.charId].push(chat);
  });

  let html = `<div style="padding:0.8rem 1rem 0.4rem;font-size:0.8rem;color:var(--text-light);font-weight:600;letter-spacing:0.05em;">聊天列表</div>`;

  Object.entries(chatsByChar).forEach(([charId, chats]) => {
    const char = state.chats.length && state.chars.find(c => c.id === charId);
    if (!char) return;
    const isImg = char.avatar?.startsWith('data:') || isImgSrc(char.avatar);
    const avatarHtml = isImg
      ? `<img src="${char.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : `<span style="font-size:1.3rem;">${char.avatar || '🌸'}</span>`;

    chats.forEach(chat => {
      const lastMsg = chat.messages[chat.messages.length - 1];
      const preview = lastMsg?.content?.slice(0, 40) || '開始聊天...';
      const isActive = chat.id === state.activeChat;
      html += `
        <div onclick="openChatFromMobile('${chat.id}')"
          style="display:flex;align-items:center;gap:0.85rem;padding:0.8rem 1rem;
            border-bottom:1px solid rgba(201,184,232,0.12);cursor:pointer;
            background:${isActive ? 'rgba(201,184,232,0.18)' : 'transparent'};
            transition:background 0.15s;">
          <div style="width:44px;height:44px;border-radius:50%;flex-shrink:0;
            background:linear-gradient(135deg,var(--lavender),var(--milk-blue));
            display:flex;align-items:center;justify-content:center;overflow:hidden;">
            ${avatarHtml}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.88rem;color:var(--text-dark);">${char.name}</div>
            <div style="font-size:0.75rem;color:var(--text-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${preview}</div>
          </div>
        </div>`;
    });
  });

  container.innerHTML = html;
}

function showMobileChatList() {
  // ‹ 返回按鈕：回到內嵌聊天列表
  const container = document.getElementById('mobile-chat-list');
  const messagesArea = document.getElementById('messages-area');
  const inputArea    = document.getElementById('input-area');
  const chatHeader   = document.getElementById('chat-header');
  if (container)    container.style.display = 'flex';
  if (messagesArea) messagesArea.style.display = 'none';
  if (inputArea)    inputArea.style.display    = 'none';
  if (chatHeader)   chatHeader.style.display   = 'none';
  renderMobileChatList();
}

function openChatFromMobile(chatId) {
  // 隱藏內嵌列表，顯示聊天視窗
  const container = document.getElementById('mobile-chat-list');
  if (container) container.style.display = 'none';
  const messagesArea = document.getElementById('messages-area');
  const inputArea    = document.getElementById('input-area');
  if (messagesArea) messagesArea.style.display = '';
  if (inputArea)    inputArea.style.display    = 'flex';
  openChat(chatId);
}

// ─── SIDEBAR ────────────────────────────────────────
function renderSidebar(mode = 'chat') {
  const list = document.getElementById('sidebar-list');
  list.innerHTML = '';

  if (mode === 'chat') {
    // Group chats by char
    const chatsByChar = {};
    state.chats.forEach(chat => {
      if (!chatsByChar[chat.charId]) chatsByChar[chat.charId] = [];
      chatsByChar[chat.charId].push(chat);
    });

    if (state.chats.length === 0) {
      list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-light);font-size:0.82rem;">還沒有對話<br>新增角色後開始聊天</div>`;
      return;
    }

    // Sort chats by last message time
    const sortedChats = [...state.chats].sort((a,b) => {
      const aTime = a.messages.length ? a.messages[a.messages.length-1].time : 0;
      const bTime = b.messages.length ? b.messages[b.messages.length-1].time : 0;
      return bTime - aTime;
    });

    sortedChats.forEach(chat => {
      const char = state.chars.find(c => c.id === chat.charId);
      if (!char) return;
      const lastMsg = chat.messages[chat.messages.length-1];
      const preview = lastMsg ? applyRegex(lastMsg.content.slice(0,40)) : '（新對話）';
      const timeStr = lastMsg ? formatTime(lastMsg.time) : '';
      const isActive = chat.id === state.activeChat;
      const avatarHtml = isImgSrc(char.avatar)
        ? `<img src="${char.avatar}" alt="">`
        : `<span>${char.avatar || '🌸'}</span>`;

      const div = document.createElement('div');
      div.className = 'chat-item' + (isActive ? ' active' : '');
      div.innerHTML = `
        <div class="chat-avatar">${avatarHtml}<div class="chat-avatar-status"></div></div>
        <div class="chat-meta">
          <div class="chat-name">${char.name} <span style="font-size:0.7rem;color:var(--text-light);font-weight:400">${chat.title || ''}</span></div>
          <div class="chat-preview">${preview}...</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;">
          <div class="chat-time">${timeStr}</div>
        </div>
      `;
      div.onclick = () => openChat(chat.id);
      list.appendChild(div);
    });
  }
}

function showAddChatOrChar() {
  if (state.chars.length === 0) {
    openModal('add-char-modal');
  } else {
    // Show char picker to start new chat
    showCharPickerForNewChat();
  }
}

function showCharPickerForNewChat() {
  // Simple inline modal
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">選擇要對話的角色</div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;max-height:350px;overflow-y:auto;">
        ${state.chars.map(c => `
          <div onclick="createNewChat('${c.id}');this.closest('.modal-overlay').remove()" 
               style="display:flex;align-items:center;gap:0.8rem;padding:0.8rem;background:var(--lavender-soft);border-radius:14px;cursor:pointer;border:1px solid rgba(201,184,232,0.2)">
            <div style="width:40px;height:40px;border-radius:13px;background:linear-gradient(135deg,var(--lavender),var(--milk-blue));display:flex;align-items:center;justify-content:center;font-size:1.2rem;overflow:hidden;">
              ${isImgSrc(c.avatar) ? `<img src="${c.avatar}" style="width:100%;height:100%;object-fit:cover">` : (c.avatar || '🌸')}
            </div>
            <div>
              <div style="font-weight:500;color:var(--text-dark)">${c.name}</div>
              <div style="font-size:0.75rem;color:var(--text-light)">${(c.desc||'').slice(0,40)}...</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button class="modal-btn secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
        <button class="modal-btn primary" onclick="this.closest('.modal-overlay').remove();openModal('add-char-modal')">＋ 新增角色</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function createNewChat(charId) {
  const char = state.chars.find(c => c.id === charId);
  if (!char) return;
  const chat = {
    id: uid(),
    charId,
    title: '',
    messages: [],
    createdAt: Date.now(),
  };
  state.chats.push(chat);
  await dbPut('chats', chat);
  openChat(chat.id);
  renderSidebar();
}

function openChat(chatId) {
  state.activeChat = chatId;
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat) return;
  const char = state.chars.find(c => c.id === chat.charId);
  if (!char) return;

  state.activeCharId = char.id;

  // Always switch to chat page first (fixes sidebar click with no response)
  state.currentPage = 'chat';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('chat-page').classList.add('active');
  const nb = document.getElementById('nav-chat');
  const bnb = document.getElementById('bnav-chat');
  if (nb) nb.classList.add('active');
  if (bnb) bnb.classList.add('active');

  // Update header
  document.getElementById('chat-header').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  const emptyChat = document.getElementById('empty-chat');
  if (emptyChat) emptyChat.style.display = 'none';

  const avatarDiv = document.getElementById('header-avatar');
  const isImgAv = isImgSrc(char.avatar) || char.avatar?.startsWith('data:');
  avatarDiv.innerHTML = isImgAv
    ? `<img src="${char.avatar}" alt="">` : (char.avatar || '🌸');
  document.getElementById('header-name').textContent = char.name;

  // 副標題：Persona + 關係進度
  const persona = char.personaId ? state.personas.find(p => p.id === char.personaId) : null;
  const statusEl = document.getElementById('header-status');
  const relLv = getRelLevel(char.id);
  const relD = getRelData(char.id);
  const relHtml = `<span style="color:${relLv.color}">${relLv.emoji} ${relLv.label}</span> &nbsp;·&nbsp; <span style="color:var(--text-light)">好感 ${relD.score}</span>`;
  if (persona) {
    statusEl.innerHTML = `<span style="color:var(--lavender);font-weight:500;">🎭 ${persona.name}</span> &nbsp;·&nbsp; ${relHtml}`;
  } else {
    statusEl.innerHTML = relHtml;
  }

  // Render messages
  renderMessages(chatId);

  // Update sidebar active state
  renderSidebar();

  // Send first message if empty
  if (chat.messages.length === 0 && char.firstMsg) {
    setTimeout(() => addAIMessage(chatId, char.firstMsg), 300);
  }

  // Render memory
  renderMemoryPanel(chatId);

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('mobile-open');

  // 手機：確保內嵌列表隱藏，聊天內容可見
  const mobileChatList = document.getElementById('mobile-chat-list');
  if (mobileChatList) mobileChatList.style.display = 'none';
  const messagesArea = document.getElementById('messages-area');
  const inputArea    = document.getElementById('input-area');
  if (messagesArea) messagesArea.style.display = '';
  if (inputArea && state.activeChat) inputArea.style.display = 'flex';
}

// ─── MESSAGES ───────────────────────────────────────
function renderMessages(chatId, opts = {}) {
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat) return;
  const area = document.getElementById('messages-area');
  area.innerHTML = '';

  // Group consecutive messages by role
  let groups = [];
  let currentGroup = null;
  chat.messages.forEach(msg => {
    if (!currentGroup || currentGroup.role !== msg.role) {
      currentGroup = { role: msg.role, messages: [] };
      groups.push(currentGroup);
    }
    currentGroup.messages.push(msg);
  });

  // Date dividers
  let lastDate = null;

  groups.forEach(group => {
    const char = state.chars.find(c => c.id === state.activeCharId);
    const firstMsg = group.messages[0];
    const msgDate = new Date(firstMsg.time).toLocaleDateString('zh-TW');

    if (msgDate !== lastDate) {
      lastDate = msgDate;
      const div = document.createElement('div');
      div.className = 'date-divider';
      div.innerHTML = `<span>${msgDate}</span>`;
      area.appendChild(div);
    }

    const groupEl = document.createElement('div');
    groupEl.className = 'msg-group ' + group.role;

    group.messages.forEach((msg, idx) => {
      const row = document.createElement('div');
      row.className = 'msg-row';
      row.dataset.msgId = msg.id;

      let avatarHtml = '';
      if (group.role === 'ai') {
        const av = char?.avatar;
        const avIsImg = isImgSrc(av);
        const avContent = avIsImg ? `<img src="${av}" alt="">` : (av || '🌸');
        avatarHtml = idx === 0
          ? `<div class="msg-avatar">${avContent}</div>`
          : `<div class="msg-avatar-spacer"></div>`;
      }

      const processedContent = applyRegex(msg.content);
      let bubbleContent = '';
      if (msg.type === 'image' && msg.imageUrl) {
        bubbleContent = `<div class="msg-image" onclick="previewImage('${msg.imageUrl}')"><img src="${msg.imageUrl}" alt="生成圖片" loading="lazy"></div>`;
      } else if (msg.type === 'sticker') {
        bubbleContent = `<div class="msg-sticker">${processedContent}</div>`;
      } else {
        bubbleContent = `<div class="msg-bubble">${processedContent.replace(/\n/g,'<br>')}</div>`;
      }

      const timeEl = idx === group.messages.length - 1
        ? `<div class="msg-time">${formatTime(msg.time)}</div>` : '';

      // Hover action buttons (desktop)
      const isUser = group.role === 'user';
      const actionsHtml = `<div class="msg-actions ${isUser ? 'msg-actions-left' : 'msg-actions-right'}">
        <button class="msg-action-btn" onclick="startInlineEdit('${msg.id}')" title="編輯">✏️</button>
        <button class="msg-action-btn" onclick="copyMsg('${msg.id}')" title="複製">📋</button>
        ${!isUser ? `<button class="msg-action-btn" onclick="ctxRegenFromMsg('${msg.id}')" title="重新生成">🔄</button>` : ''}
        <button class="msg-action-btn danger" onclick="deleteMsgDirect('${msg.id}')" title="刪除">🗑️</button>
      </div>`;

      if (state.swipeDelete) {
        // ── 滑動刪除模式：不顯示 × 按鈕，左滑氣泡露出刪除區 ──
        // 用 wrapper 包住 row 本體，後面放一個紅色刪除底層
        row.style.cssText += 'overflow:visible;';
        if (isUser) {
          row.innerHTML = `${actionsHtml}${timeEl}${bubbleContent}`;
        } else {
          row.innerHTML = `${avatarHtml}${bubbleContent}${timeEl}${actionsHtml}`;
        }

        // 建立 swipe wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'swipe-wrapper';
        wrapper.style.cssText = 'position:relative;overflow:hidden;border-radius:12px;';

        // 刪除底層（露出時可見）
        const delLayer = document.createElement('div');
        delLayer.className = 'swipe-del-layer';
        delLayer.innerHTML = `<span style="font-size:1.2rem">🗑️</span><span style="font-size:0.72rem;margin-top:2px;">刪除</span>`;
        delLayer.style.cssText = `
          position:absolute; top:0; right:0; bottom:0; width:70px;
          background:linear-gradient(135deg,#e87878,#d04040);
          display:flex; flex-direction:column; align-items:center; justify-content:center;
          color:white; border-radius:12px; pointer-events:none;
          opacity:0; transition:opacity 0.1s;
        `;

        // 把 row 移進 wrapper
        wrapper.appendChild(delLayer);
        wrapper.appendChild(row);
        groupEl.appendChild(wrapper);

        // 滑動邏輯：只對 row 做 translateX，不影響 messages-area
        let swStartX = 0, swStartY = 0, swTracking = false, swOffset = 0;
        const MAX_SWIPE = 75;
        const TRIGGER = 55;

        row.addEventListener('touchstart', e => {
          swStartX = e.touches[0].clientX;
          swStartY = e.touches[0].clientY;
          swTracking = true;
          row.style.transition = 'none';
        }, { passive: true });

        row.addEventListener('touchmove', e => {
          if (!swTracking) return;
          const dx = e.touches[0].clientX - swStartX;
          const dy = e.touches[0].clientY - swStartY;
          if (Math.abs(dy) > Math.abs(dx) + 8) { swTracking = false; return; }
          // 阻止 messages-area 水平移動，只動 row 本身
          if (Math.abs(dx) > 5) e.stopPropagation();
          const shift = Math.max(-MAX_SWIPE, Math.min(0, dx));
          swOffset = shift;
          row.style.transform = `translateX(${shift}px)`;
          delLayer.style.opacity = Math.min(1, Math.abs(shift) / TRIGGER).toString();
        }, { passive: true });

        row.addEventListener('touchend', e => {
          if (!swTracking) return;
          swTracking = false;
          row.style.transition = 'transform 0.2s ease';
          if (swOffset <= -TRIGGER) {
            // 確認刪除
            row.style.transform = `translateX(-100%)`;
            delLayer.style.opacity = '0';
            setTimeout(() => deleteMsgSilent(msg.id), 180);
          } else {
            row.style.transform = 'translateX(0)';
            delLayer.style.opacity = '0';
          }
          swOffset = 0;
        });

      } else {
        // ── × 按鈕模式 ──
        const delBtnHtml = `<button class="msg-del-btn" onclick="deleteMsgDirect('${msg.id}')" title="刪除">×</button>`;
        if (isUser) {
          row.innerHTML = `${delBtnHtml}${actionsHtml}${timeEl}${bubbleContent}`;
        } else {
          row.innerHTML = `${avatarHtml}${bubbleContent}${timeEl}${actionsHtml}${delBtnHtml}`;
        }
        groupEl.appendChild(row);
      }

      // Desktop: right-click context menu
      row.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, msg.id); });
    });

    area.appendChild(groupEl);
  });

  // Typing indicator placeholder
  area.innerHTML += `<div id="typing-indicator" style="display:none;"><div class="msg-group ai"><div class="msg-row"><div class="msg-avatar">${(() => { const c = state.chars.find(c=>c.id===state.activeCharId); const av = c?.avatar; return isImgSrc(av) ? `<img src="${av}">` : (av||'🌸'); })()}</div><div class="msg-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div></div></div>`;

  if (opts.preserveScroll && opts.scrollTop != null) {
    area.scrollTop = opts.scrollTop;
  } else {
    scrollToBottom();
  }
}

function showMobileActionBar(msgId, isUser) {
  // 移除已有的浮動列
  document.getElementById('mobile-action-bar')?.remove();

  const chat = state.chats.find(c => c.id === state.activeChat);
  const msg = chat?.messages.find(m => m.id === msgId);
  if (!msg) return;

  const bar = document.createElement('div');
  bar.id = 'mobile-action-bar';
  bar.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0;
    background: rgba(255,255,255,0.97);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid rgba(201,184,232,0.3);
    display: flex; align-items: center; justify-content: center;
    gap: 0.3rem; padding: 0.55rem 1rem;
    z-index: 9000;
    box-shadow: 0 2px 16px rgba(180,160,210,0.2);
    animation: slideDown 0.18s ease;
  `;

  const actions = [
    { icon: '✏️', label: '編輯', fn: () => { startInlineEdit(msgId); bar.remove(); } },
    { icon: '📋', label: '複製', fn: () => { copyMsg(msgId); bar.remove(); } },
    ...(!isUser ? [{ icon: '🔄', label: '重生成', fn: () => { ctxRegenFromMsg(msgId); bar.remove(); } }] : []),
    { icon: '🗑️', label: '刪除', danger: true, fn: () => { bar.remove(); deleteMsgDirect(msgId); } },
    { icon: '✕', label: '關閉', fn: () => bar.remove() },
  ];

  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      display: flex; flex-direction: column; align-items: center; gap: 0.15rem;
      background: ${a.danger ? 'rgba(232,120,120,0.1)' : 'var(--lavender-soft)'};
      border: 1px solid ${a.danger ? 'rgba(232,120,120,0.25)' : 'rgba(201,184,232,0.25)'};
      border-radius: 10px; padding: 0.35rem 0.6rem;
      font-family: inherit; cursor: pointer;
      color: ${a.danger ? '#e87878' : 'var(--text-mid)'};
    `;
    btn.innerHTML = `<span style="font-size:1.1rem">${a.icon}</span><span style="font-size:0.62rem">${a.label}</span>`;
    btn.addEventListener('touchend', e => { e.preventDefault(); a.fn(); });
    bar.appendChild(btn);
  });

  document.body.appendChild(bar);
  if (navigator.vibrate) navigator.vibrate(25);

  // 點 bar 以外收起
  setTimeout(() => {
    const dismiss = e => {
      if (!bar.contains(e.target)) {
        bar.remove();
        document.removeEventListener('touchstart', dismiss, true);
      }
    };
    document.addEventListener('touchstart', dismiss, true);
  }, 100);
}

function addAIMessage(chatId, content, type = 'text', imageUrl = null) {
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat) return;
  const msg = { id: uid(), role: 'ai', content, type, imageUrl, time: Date.now() };
  chat.messages.push(msg);
  dbPut('chats', chat);
  // 只在這個 chatId 仍是目前活躍視窗時才渲染，避免污染其他聊天室
  if (state.activeChat === chatId) renderMessages(chatId);
  return msg;
}

function addUserMessage(chatId, content) {
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat) return;
  const msg = { id: uid(), role: 'user', content, type: 'text', time: Date.now() };
  chat.messages.push(msg);
  dbPut('chats', chat);
  // 只在這個 chatId 仍是目前活躍視窗時才渲染
  if (state.activeChat === chatId) renderMessages(chatId);
  return msg;
}

// ─── CHAT IMAGE UPLOAD ──────────────────────────────
let pendingChatImages = []; // [{base64, mimeType}]

function handleChatImageUpload(event) {
  const files = [...event.target.files];
  event.target.value = ''; // reset so same file can be re-selected
  files.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const mimeType = file.type;
      const base64 = dataUrl.split(',')[1];
      pendingChatImages.push({ base64, mimeType, dataUrl });
      renderChatImgPreviewStrip();
    };
    reader.readAsDataURL(file);
  });
}

function renderChatImgPreviewStrip() {
  const strip = document.getElementById('chat-img-preview-strip');
  if (!strip) return;
  if (pendingChatImages.length === 0) {
    strip.style.display = 'none';
    strip.innerHTML = '';
    return;
  }
  strip.style.display = 'flex';
  strip.innerHTML = pendingChatImages.map((img, i) => `
    <div class="chat-img-thumb">
      <img src="${img.dataUrl}" alt="圖片${i+1}">
      <button class="thumb-del" onclick="removePendingImg(${i})" title="移除">×</button>
    </div>
  `).join('') + `<span style="font-size:0.72rem;color:var(--text-light);align-self:center;">${pendingChatImages.length} 張圖片</span>`;
}

function removePendingImg(idx) {
  pendingChatImages.splice(idx, 1);
  renderChatImgPreviewStrip();
}

async function sendMessage() {
  if (!state.activeChat) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  const hasImages = pendingChatImages.length > 0;
  if (!text && !hasImages) return;
  input.value = '';
  input.style.height = 'auto';

  const thisChatId = state.activeChat;
  const thisCharId = state.activeCharId;
  const imagesToSend = [...pendingChatImages];
  pendingChatImages = [];
  renderChatImgPreviewStrip();

  const chat = state.chats.find(c => c.id === thisChatId);
  if (!chat) return;

  if (imagesToSend.length > 0) {
    imagesToSend.forEach(img => {
      const msg = { id: uid(), role: 'user', content: text || '（圖片）', type: 'image', imageUrl: img.dataUrl, time: Date.now() };
      chat.messages.push(msg);
    });
    dbPut('chats', chat);
    if (state.activeChat === thisChatId) renderMessages(thisChatId);
  } else if (text) {
    addUserMessage(thisChatId, text);
  }

  updateChatStats(thisCharId);
  if (state.activeChat === thisChatId) showTyping();

  try {
    const responses = await callGemini(thisChatId, text || '（圖片）', null, imagesToSend);
    if (state.activeChat === thisChatId) hideTyping();
    for (let i = 0; i < responses.length; i++) {
      const msgLen = responses[i].length;
      const typingDelay = Math.min(300 + msgLen * 55, 2200) + Math.random() * 300;
      await delay(typingDelay);
      addAIMessage(thisChatId, responses[i]);
      if (i < responses.length - 1) {
        if (state.activeChat === thisChatId) showTyping();
        await delay(350 + Math.random() * 250);
      }
    }
    await autoUpdateMemory(thisChatId);
    // 關係系統：評分 + 特別時刻偵測
    scoreConversation(thisChatId, thisCharId).catch(()=>{});
    checkForSpecialMoments(thisChatId, thisCharId).catch(()=>{});
  } catch(err) {
    if (state.activeChat === thisChatId) hideTyping();
    addAIMessage(thisChatId, `（系統錯誤：${err.message}）`);
  }
}

// 把目前輸入欄的文字加入合併佇列（不立即送出）
function queueMessage() {
  if (!state.activeChat) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  const hasImages = pendingChatImages.length > 0;
  if (!text && !hasImages) return;
  input.value = '';
  input.style.height = 'auto';

  const thisChatId = state.activeChat;
  const thisCharId = state.activeCharId;
  const imagesToSend = [...pendingChatImages];
  pendingChatImages = [];
  renderChatImgPreviewStrip();

  if (_batchChatId !== thisChatId) {
    // 切換了聊天室，重設
    _batchBuffer = [];
    _batchImages = [];
  }
  _batchChatId = thisChatId;
  _batchCharId = thisCharId;
  if (text) _batchBuffer.push(text);
  if (imagesToSend.length) _batchImages.push(...imagesToSend);

  updateBatchUI();
  showToast(`📝 已加入佇列（共 ${_batchBuffer.length + _batchImages.length} 則）`);
}

function updateBatchUI() {
  const count = _batchBuffer.length + _batchImages.length;
  let flushBtn = document.getElementById('flush-btn');

  if (count === 0) {
    if (flushBtn) flushBtn.style.display = 'none';
    return;
  }

  if (!flushBtn) {
    flushBtn = document.createElement('button');
    flushBtn.id = 'flush-btn';
    flushBtn.onclick = flushBatch;
    flushBtn.style.cssText = `
      position:absolute; bottom:100%; left:50%; transform:translateX(-50%);
      margin-bottom:6px;
      background:linear-gradient(135deg,var(--lavender),var(--milk-blue));
      color:white; border:none; border-radius:20px;
      padding:0.4rem 1.1rem; font-family:inherit; font-size:0.78rem;
      cursor:pointer; white-space:nowrap;
      box-shadow:0 2px 10px rgba(180,160,210,0.35);
      z-index:10;
    `;
    const inputArea = document.getElementById('input-area');
    if (inputArea) {
      inputArea.style.position = 'relative';
      inputArea.appendChild(flushBtn);
    }
  }

  flushBtn.textContent = `🚀 送出（已排 ${count} 則）`;
  flushBtn.style.display = 'block';
}


// ─── MESSAGE BATCHING ────────────────────────────────
// 分段傳送累積機制：按 ➤ 累積訊息，按「🚀 送出」才真正送給 AI
let _batchBuffer = [];           // 累積的訊息文字
let _batchImages = [];           // 累積的圖片
let _batchChatId = null;
let _batchCharId = null;

async function flushBatch() {
  if (!_batchBuffer.length && !_batchImages.length) return;

  // 隱藏合併送出按鈕
  const flushBtn = document.getElementById('flush-btn');
  if (flushBtn) flushBtn.style.display = 'none';

  const thisChatId = _batchChatId;
  const thisCharId = _batchCharId;
  const combinedText = _batchBuffer.join('\n').trim();
  const imagesToSend = [..._batchImages];
  _batchBuffer = [];
  _batchImages = [];
  _batchChatId = null;
  _batchCharId = null;

  const chat = state.chats.find(c => c.id === thisChatId);
  if (!chat) return;

  if (imagesToSend.length > 0) {
    imagesToSend.forEach(img => {
      const msg = { id: uid(), role: 'user', content: combinedText || '（圖片）', type: 'image', imageUrl: img.dataUrl, time: Date.now() };
      chat.messages.push(msg);
    });
    dbPut('chats', chat);
    if (state.activeChat === thisChatId) renderMessages(thisChatId);
  } else if (combinedText) {
    addUserMessage(thisChatId, combinedText);
  }

  updateChatStats(thisCharId);
  if (state.activeChat === thisChatId) showTyping();

  try {
    const responses = await callGemini(thisChatId, combinedText || '（圖片）', null, imagesToSend);
    if (state.activeChat === thisChatId) hideTyping();
    for (let i = 0; i < responses.length; i++) {
      const msgLen = responses[i].length;
      const typingDelay = Math.min(300 + msgLen * 55, 2200) + Math.random() * 300;
      await delay(typingDelay);
      addAIMessage(thisChatId, responses[i]);
      if (i < responses.length - 1) {
        if (state.activeChat === thisChatId) showTyping();
        await delay(350 + Math.random() * 250);
      }
    }
    await autoUpdateMemory(thisChatId);
    scoreConversation(thisChatId, thisCharId).catch(()=>{});
    checkForSpecialMoments(thisChatId, thisCharId).catch(()=>{});
  } catch(err) {
    if (state.activeChat === thisChatId) hideTyping();
    addAIMessage(thisChatId, `（系統錯誤：${err.message}）`);
  }
}


async function callGemini(chatId, userMessage, overrideSystem = null, userImages = []) {
  const chat = state.chats.find(c => c.id === chatId);
  const char = state.chars.find(c => c.id === chat.charId);
  const persona = char?.personaId ? state.personas.find(p => p.id === char.personaId) : null;

  // Build system prompt
  let systemParts = [
    (overrideSystem || state.systemPrompt)
      .replace(/\{\{char\}\}/g, char?.name || 'AI')
      .replace(/\{\{user\}\}/g, persona?.name || 'user'),
  ];

  if (char?.desc) systemParts.push(`\n[Character Sheet]\n${char.desc}`);

  // 關係進度注入 system prompt
  const relInfo = getRelData(chat.charId);
  const relLvInfo = REL_LEVELS.find(r => r.id === relInfo.level) || REL_LEVELS[0];
  systemParts.push(`\n[Relationship Stage]\nCurrent relationship stage: "${relLvInfo.label}" (${relLvInfo.id}).\nBehave consistently with this stage. Do NOT rush to the next stage artificially.`);
  if (persona) systemParts.push(`\n[User Persona]\n你正在和 ${persona.name} 說話。${persona.desc || ''}`);

  // Lorebook injection
  const lorebookMatches = getLorebookMatches(userMessage);
  if (lorebookMatches.length) {
    systemParts.push('\n[World Information]\n' + lorebookMatches.join('\n'));
  }

  // Memory injection
  const memories = state.memory[chatId] || [];
  if (memories.length) {
    const memText = memories.map(m => `[${m.category}] ${m.text}`).join('\n');
    systemParts.push('\n[Long-term Memory]\n' + memText);
  }

  // Jailbreak
  if (state.jailbreak && state.jailbreakPosition === 'system') {
    systemParts.push('\n' + state.jailbreak);
  }

  const systemInstruction = systemParts.join('');

  // Build conversation history (last 30 messages)
  const history = chat.messages.slice(-state.contextMsgs).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  // Remove last user message (we'll add it separately)
  if (history.length && history[history.length-1].role === 'user') history.pop();

  // Jailbreak before last
  let contents = [...history];
  // Build last user message parts (text + optional images)
  const lastUserParts = [];
  if (userImages && userImages.length > 0) {
    userImages.forEach(img => {
      lastUserParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    });
  }
  if (state.jailbreak && state.jailbreakPosition === 'before_last') {
    lastUserParts.push({ text: state.jailbreak + '\n\n' + userMessage });
  } else {
    lastUserParts.push({ text: userMessage });
  }
  contents.push({ role: 'user', parts: lastUserParts });

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      temperature: state.temperature,
      maxOutputTokens: state.maxTokens,
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('chat')}:generateContent?key=${state.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'API Error ' + res.status);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '...';

  // Split into multiple short messages (LINE style)
  return splitIntoMessages(text);
}

function splitIntoMessages(text) {
  // Step 1: 優先按雙換行（AI 用 \n\n 明確分隔的訊息）切割
  const doubleNewlineParts = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);

  if (doubleNewlineParts.length >= 2) {
    // AI 有正確分段，直接使用，最多 6 段
    return doubleNewlineParts.slice(0, 6);
  }

  // Step 2: 只有單換行，按換行切
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length >= 2) {
    // 每行就是一則訊息，但超長的行再按句號切
    const result = [];
    for (const line of lines) {
      if (line.length <= 60) {
        result.push(line);
      } else {
        // 長行按句子切
        const sents = line.match(/[^。！？…～]+[。！？…～]*/g) || [line];
        let cur = '';
        for (const s of sents) {
          if (cur && (cur.length + s.length) > 50) {
            result.push(cur.trim());
            cur = s;
          } else {
            cur += s;
          }
        }
        if (cur.trim()) result.push(cur.trim());
      }
    }
    return result.slice(0, 6);
  }

  // Step 3: 整段文字，按句子切成 LINE 氣泡
  const sentences = text.match(/[^。！？…～\n]+[。！？…～]*/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (!cur) { cur = s; continue; }
    // 50 字內可以合併成同一則，超過就新開一則
    if ((cur + s).length <= 50) {
      cur += s;
    } else {
      chunks.push(cur.trim());
      cur = s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean).slice(0, 6);
}

// ─── GEMINI IMAGE GEN ─────────────────────────────
// refImages: [{base64: 'data:image/png;base64,...'}]
// getAvatarRef() returns { base64: dataUrl } — we handle both formats here
async function callGeminiImage(prompt, refImages = []) {
  const imageModel = 'gemini-3-pro-image-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${state.apiKey}`;

  // 組裝 parts：先放參考圖，再放文字 prompt
  const parts = [];
  for (const img of refImages) {
    if (!img) continue;
    // Support both {base64: dataUrl} from getAvatarRef and {base64, mimeType} raw formats
    const dataUrl = img.base64 || img.dataUrl || null;
    if (!dataUrl) continue;
    // Extract mimeType and raw base64 from data URL
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) {
      console.warn('[callGeminiImage] Could not parse image dataUrl:', dataUrl?.slice(0,60));
      continue;
    }
    const mimeType = img.mimeType || match[1];
    const rawB64   = match[2];
    parts.push({ inlineData: { mimeType, data: rawB64 } });
  }
  console.log('[callGeminiImage] sending', parts.length - 0, 'ref parts (images) + 1 text part');
  parts.push({ text: prompt });

  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Image gen failed: ' + res.status);

  const resParts = data.candidates?.[0]?.content?.parts || [];
  for (const part of resParts) {
    if (part.inlineData?.mimeType?.startsWith('image/')) {
      return 'data:' + part.inlineData.mimeType + ';base64,' + part.inlineData.data;
    }
  }
  const textPart = resParts.find(p => p.text);
  throw new Error(textPart?.text || '未收到圖片，請確認模型是否支援圖片生成');
}

// 把 emoji/URL avatar 轉成可用的 base64 ref（只有 base64 格式才上傳）
function getAvatarRef(avatarStr) {
  if (!avatarStr) return null;
  if (avatarStr.startsWith('data:image')) return { base64: avatarStr };
  return null; // emoji 或 URL 不上傳
}

// ─── CHAT IMAGE GEN MODAL ───────────────────────────
let _imageGenType  = 'solo';
let _imageGenStyle = 'anime';

function triggerImageGen() {
  if (!state.activeChat) return;
  const chat = state.chats.find(c => c.id === state.activeChat);
  const char = state.chars.find(c => c.id === chat?.charId);
  if (!char) return;

  // Reset selections
  _imageGenType  = 'solo';
  _imageGenStyle = 'anime';
  document.querySelectorAll('.imagegen-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'solo'));
  document.querySelectorAll('.imagegen-style-btn').forEach(b => b.classList.toggle('active', b.dataset.style === 'anime'));
  document.getElementById('imagegen-extra-prompt').value = '';

  // Show reference image info
  const persona = char.personaId ? state.personas.find(p => p.id === char.personaId) : null;
  const refInfo = document.getElementById('imagegen-ref-info');
  const refs = [];
  if (getAvatarRef(char.avatar)) refs.push(`角色頭像（${char.name}）`);
  if (persona && getAvatarRef(persona.avatar)) refs.push(`Persona 頭像（${persona.name}）`);
  if (refInfo) {
    refInfo.textContent = refs.length
      ? `✓ 將上傳參考圖：${refs.join('、')}`
      : '（未設定頭像圖片，將依角色描述生成）';
  }

  openModal('imagegen-modal');
}

function selectImageGenType(type, btn) {
  _imageGenType = type;
  document.querySelectorAll('.imagegen-type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function selectImageGenStyle(style, btn) {
  _imageGenStyle = style;
  document.querySelectorAll('.imagegen-style-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function doTriggerImageGen() {
  closeModal('imagegen-modal');
  if (!state.activeChat) return;
  const chat = state.chats.find(c => c.id === state.activeChat);
  const char = state.chars.find(c => c.id === chat?.charId);
  if (!char) return;

  showToast('🖼️ 正在生成圖片...');

  try {
    const recentMsgs = chat.messages.slice(-6).map(m => m.content).join(' ');
    const extraPrompt = document.getElementById('imagegen-extra-prompt')?.value?.trim() || '';
    const persona = char.personaId ? state.personas.find(p => p.id === char.personaId) : null;

    // ── Collect reference images ──
    const refImages = [];
    const charRef = getAvatarRef(char.avatar);
    if (charRef) refImages.push(charRef);
    if (_imageGenType === 'duo' && persona?.avatar) {
      const personaRef = getAvatarRef(persona.avatar);
      if (personaRef) refImages.push(personaRef);
    }

    // ── Style map ──
    const styleDescMap = {
      anime:      'anime illustration, soft cel shading, clean lineart, vibrant colors',
      watercolor: 'soft watercolor illustration, pastel palette, dreamy and gentle, painterly texture',
      chibi:      'chibi cute style, super deformed proportions, big sparkling eyes, kawaii',
      sketch:     'pencil sketch style, clean lineart, monochrome with soft shading, artbook quality',
      fantasy:    'fantasy illustration, detailed background, magical atmosphere, anime style',
      lofi:       'lo-fi aesthetic, muted pastel tones, cozy atmosphere, illustrated art, soft glow',
    };
    const styleDesc = styleDescMap[_imageGenStyle] || styleDescMap.anime;

    const isDuo = _imageGenType === 'duo';
    // Stronger ref note when images are available
    const refNote = refImages.length > 0
      ? 'IMPORTANT: Use the provided reference image(s) to maintain exact character appearance and design. '
      : '';
    const personaNote = isDuo && persona
      ? ` alongside ${persona.name}${persona.desc ? ` (${persona.desc.slice(0,80)})` : ''}`
      : '';

    // Dynamic scene from recent conversation — not hardcoded
    const sceneContext = recentMsgs
      ? `Scene/mood inspired by this conversation (do NOT include text in image): "${recentMsgs.slice(0,200)}"`
      : `A moment from ${char.name}'s daily life`;

    const prompt = [
      refNote,
      `Style: ${styleDesc}.`,
      `Character: ${char.name}${char.desc ? ` — ${char.desc.slice(0,150)}` : ''}${personaNote}.`,
      sceneContext + '.',
      extraPrompt ? `Additional details: ${extraPrompt}.` : '',
      'NOT photorealistic. NOT a photograph. Pure illustrated art only. No text, no watermarks, no logos.',
    ].filter(Boolean).join(' ');
    console.log('[ChatImageGen] refImages:', refImages.length, '| style:', _imageGenStyle, '| type:', _imageGenType);

    const imageUrl = await callGeminiImage(prompt, refImages);
    addAIMessage(state.activeChat, '📸 生成了一張圖片', 'image', imageUrl);
  } catch(err) {
    showToast('圖片生成失敗：' + err.message);
  }
}

// ─── MEMORY ─────────────────────────────────────────
async function autoUpdateMemory(chatId) {
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat || chat.messages.length < 4) return;

  // Every 6 messages, extract memories
  if (chat.messages.length % 6 !== 0) return;

  try {
    const recent = chat.messages.slice(-12).map(m => `${m.role}: ${m.content}`).join('\n');
    const prompt = `From this conversation, extract important facts to remember (user preferences, shared experiences, plans, emotional moments). Return JSON array: [{"category":"喜好/回憶/計劃/情感", "text":"..."}]. Max 3 items. Only new info not already obvious.\n\nConversation:\n${recent}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('memory')}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500 }
      })
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const clean = text.replace(/```json|```/g,'').trim();
    const items = JSON.parse(clean);

    if (!state.memory[chatId]) state.memory[chatId] = [];
    items.forEach(item => {
      if (!state.memory[chatId].find(m => m.text === item.text)) {
        state.memory[chatId].push({ ...item, id: uid() });
      }
    });

    await dbPut('memory', { id: chatId, items: state.memory[chatId] });
    renderMemoryPanel(chatId);
  } catch(e) { /* silent fail */ }
}

function renderMemoryPanel(chatId) {
  const list = document.getElementById('memory-list');
  const memories = state.memory[chatId] || [];
  const categories = {};
  memories.forEach(m => {
    if (!categories[m.category]) categories[m.category] = [];
    categories[m.category].push(m);
  });

  list.innerHTML = Object.entries(categories).map(([cat, items]) => `
    <div class="memory-category">
      <div class="memory-cat-title">${cat}</div>
      ${items.map(m => `
        <div class="memory-item">
          ${m.text}
          <span class="del-mem" onclick="deleteMemory('${chatId}','${m.id}')">×</span>
        </div>
      `).join('')}
    </div>
  `).join('') || '<div style="padding:1rem;text-align:center;color:var(--text-light);font-size:0.82rem;">聊天中會自動記住重要事項</div>';
}

async function deleteMemory(chatId, memId) {
  if (!state.memory[chatId]) return;
  state.memory[chatId] = state.memory[chatId].filter(m => m.id !== memId);
  await dbPut('memory', { id: chatId, items: state.memory[chatId] });
  renderMemoryPanel(chatId);
}

async function addMemoryItem() {
  if (!state.activeChat) return;
  const text = prompt('輸入要記住的內容：');
  if (!text) return;
  const cat = prompt('分類（喜好/回憶/計劃/情感/其他）：') || '其他';
  if (!state.memory[state.activeChat]) state.memory[state.activeChat] = [];
  state.memory[state.activeChat].push({ id: uid(), category: cat, text });
  await dbPut('memory', { id: state.activeChat, items: state.memory[state.activeChat] });
  renderMemoryPanel(state.activeChat);
  showToast('✓ 記憶已新增');
}


// ─── 心聲系統 ────────────────────────────────────────
// 心聲不存進 chat.messages，是獨立的即時內心獨白，不污染對話記錄

async function generateInnerVoice() {
  if (!state.activeChat || !state.activeCharId) return;
  const chat = state.chats.find(c => c.id === state.activeChat);
  const char = state.chars.find(c => c.id === state.activeCharId);
  if (!chat || !char) return;

  const panel = document.getElementById('inner-voice-panel');
  const textEl = document.getElementById('iv-text');
  const avatarEl = document.getElementById('iv-avatar');
  if (!panel || !textEl) return;

  // 顯示面板並開始 loading 狀態
  panel.style.display = 'block';
  textEl.textContent = '⋯';
  if (avatarEl) {
    const av = char.avatar;
    avatarEl.innerHTML = isImgSrc(av) ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover;">` : (av || '🌸');
  }

  // 取最近 10 則對話作為背景
  const recentMsgs = chat.messages.slice(-10)
    .map(m => `${m.role === 'user' ? '對方' : char.name}: ${m.content}`).join('\n');

  const persona = char.personaId ? state.personas.find(p => p.id === char.personaId) : null;
  const memories = (state.memory[state.activeChat] || []).slice(-5).map(m => m.text).join('、');

  const prompt = `你是 ${char.name}。${char.desc?.slice(0,200) || ''}
${persona ? `對方（你重要的人）是 ${persona.name}。${persona.desc || ''}` : ''}

以下是你們最近的對話：
${recentMsgs || '（還沒有對話記錄）'}
${memories ? `
你們之間重要的共同記憶：${memories}` : ''}

現在請以第一人稱（「我」）用繁體中文，寫下你此刻真實的內心獨白。
這是你不會說出口的心裡話——你真正的感受、顧慮、渴望、或是難以啟齒的想法。
字數：80～150字。直接輸出獨白，不加任何標題或說明。`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('innervoice')}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.2, maxOutputTokens: 2300 }
      })
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) {
      textEl.textContent = text;
    } else {
      textEl.textContent = '（心聲生成失敗，請稍後再試）';
    }
  } catch(e) {
    textEl.textContent = `（錯誤：${e.message}）`;
  }
}

function closeInnerVoice() {
  const panel = document.getElementById('inner-voice-panel');
  if (panel) panel.style.display = 'none';
}

function toggleMemoryPanel() {
  const panel = document.getElementById('memory-panel');
  panel.classList.toggle('open');
}

// ─── LOREBOOK ───────────────────────────────────────
// ST-compatible fields: {id, name, keys, secondary_keys, content, comment,
//   enabled, constant, selective, case_sensitive,
//   insertion_order, position, scan_depth, token_budget}
function getLorebookMatches(text) {
  // Gather all applicable lorebook entries
  const allEntries = [...state.lorebook];

  // Add active char's lorebook
  if (state.activeCharId) {
    const char = state.chars.find(c => c.id === state.activeCharId);
    if (char?.lorebook) allEntries.push(...char.lorebook);
  }
  // Add current chat's lorebook
  if (state.activeChat) {
    const chat = state.chats.find(c => c.id === state.activeChat);
    if (chat?.lorebook) allEntries.push(...chat.lorebook);
  }

  return allEntries
    .filter(entry => {
      if (!entry.enabled) return false;
      if (entry.constant) return true;
      const haystack = entry.case_sensitive ? text : text.toLowerCase();
      const keys = entry.keys || entry.keywords || [];
      return keys.some(kw => kw && haystack.includes(entry.case_sensitive ? kw : kw.toLowerCase()));
    })
    .sort((a, b) => (a.insertion_order || 100) - (b.insertion_order || 100))
    .map(entry => entry.content);
}

let lorebookEditId = null;
let currentLbTab = 'global'; // 'global' | 'char' | 'chat'

function switchLbTab(tab, btn) {
  currentLbTab = tab;
  document.querySelectorAll('#lorebook-modal .modal-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  lorebookEditId = null;

  const charSel = document.getElementById('lb-char-selector');
  const infoEl = document.getElementById('lb-scope-info');
  const infos = {
    global: ['🌍','全域：對所有對話生效 · Constant 永遠注入 · 關鍵字觸發注入'],
    char:   ['🌸','角色：僅對選定角色的所有對話生效'],
    chat:   ['💬','聊天：僅在目前聊天視窗生效，不影響其他對話'],
  };
  if (infoEl) infoEl.innerHTML = `<span>${infos[tab][0]}</span><span>${infos[tab][1]}</span>`;
  if (charSel) charSel.style.display = tab === 'char' ? 'block' : 'none';

  renderLorebookList();
}

function _getLbStore() {
  // Returns the lorebook array for current scope
  if (currentLbTab === 'global') return state.lorebook;
  if (currentLbTab === 'char') {
    const charId = document.getElementById('lb-char-sel')?.value;
    if (!charId) return [];
    const char = state.chars.find(c => c.id === charId);
    if (!char) return [];
    if (!char.lorebook) char.lorebook = [];
    return char.lorebook;
  }
  if (currentLbTab === 'chat') {
    const chat = state.chats.find(c => c.id === state.activeChat);
    if (!chat) return [];
    if (!chat.lorebook) chat.lorebook = [];
    return chat.lorebook;
  }
  return state.lorebook;
}

function _saveLbEntry(entry) {
  if (currentLbTab === 'global') {
    dbPut('lorebook', entry);
  } else if (currentLbTab === 'char') {
    const charId = document.getElementById('lb-char-sel')?.value;
    const char = state.chars.find(c => c.id === charId);
    if (char) dbPut('chars', char);
  } else if (currentLbTab === 'chat') {
    const chat = state.chats.find(c => c.id === state.activeChat);
    if (chat) dbPut('chats', chat);
  }
}

function _deleteLbEntry(id) {
  if (currentLbTab === 'global') {
    state.lorebook = state.lorebook.filter(l => l.id !== id);
    dbDelete('lorebook', id);
  } else if (currentLbTab === 'char') {
    const charId = document.getElementById('lb-char-sel')?.value;
    const char = state.chars.find(c => c.id === charId);
    if (char) { char.lorebook = (char.lorebook||[]).filter(l => l.id !== id); dbPut('chars', char); }
  } else if (currentLbTab === 'chat') {
    const chat = state.chats.find(c => c.id === state.activeChat);
    if (chat) { chat.lorebook = (chat.lorebook||[]).filter(l => l.id !== id); dbPut('chats', chat); }
  }
}

function renderLorebookList() {
  const list = document.getElementById('lorebook-list');
  if (!list) return;
  const entries = _getLbStore();
  const countEl = document.getElementById('lb-count');
  const total = entries.length;
  const enabled = entries.filter(e => e.enabled).length;
  if (countEl) countEl.textContent = `${enabled} / ${total} 條目啟用`;

  if (currentLbTab === 'char') {
    const charId = document.getElementById('lb-char-sel')?.value;
    if (!charId) {
      list.innerHTML = '<div style="text-align:center;color:var(--text-light);font-size:0.82rem;padding:2rem;">請先選擇角色</div>';
      return;
    }
  }
  if (currentLbTab === 'chat' && !state.activeChat) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-light);font-size:0.82rem;padding:2rem;">請先開啟一個聊天視窗</div>';
    return;
  }

  if (!entries.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-light);font-size:0.82rem;padding:2rem 1rem;border:1.5px dashed rgba(201,184,232,0.3);border-radius:12px;">尚無條目 — 點擊「＋ 新增條目」建立</div>';
    return;
  }

  list.innerHTML = entries.map(e => {
    const keys = e.keys || e.keywords || [];
    const keyStr = keys.join(', ') || '（無關鍵字）';
    const isOpen = lorebookEditId === e.id;
    const safeContent = (e.content || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeName = (e.name || '').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    const safeKeys = keys.join(', ').replace(/"/g,'&quot;');
    const safeSecKeys = (e.secondary_keys || []).join(', ').replace(/"/g,'&quot;');
    const safeComment = (e.comment || '').replace(/"/g,'&quot;');

    // Position friendly label
    const posLabels = { before_char:'角色描述前', after_char:'角色描述後', before_prompt:'Prompt前', at_depth:'@Depth(AN)' };
    const posLabel = posLabels[e.position||'before_char'] || e.position;

    return `<div class="lb-entry${isOpen?' lb-open':''}" id="lb-entry-${e.id}">
      <div class="lb-header" onclick="toggleLorebookEntry('${e.id}')">
        <div class="lb-entry-left">
          <button class="lb-toggle${e.enabled?' on':''}" onclick="event.stopPropagation();lbToggleEnabled('${e.id}',!this.classList.contains('on'))" title="${e.enabled?'已啟用，點擊停用':'已停用，點擊啟用'}"></button>
          ${e.constant?'<span class="lb-badge lb-const" title="Constant：永遠注入">CONST</span>':''}
          ${e.selective?'<span class="lb-badge lb-sel" title="Selective：需同時匹配 Secondary Keys">SEL</span>':''}
          <span class="lb-name">${safeName||'（未命名條目）'}</span>
        </div>
        <div class="lb-entry-right">
          <span class="lb-keys-preview" title="${keyStr}">${keyStr.slice(0,22)}${keyStr.length>22?'…':''}</span>
          <span class="lb-order" title="Insertion Order">#${e.insertion_order||100}</span>
          <button onclick="event.stopPropagation();deleteLorebook('${e.id}')" class="lb-del-btn" title="刪除">×</button>
        </div>
      </div>
      ${isOpen ? `<div class="lb-body">
        <div class="lb-row-2col">
          <div class="lb-field" style="flex:2">
            <label class="lb-label">Entry Name（條目名稱）</label>
            <input class="lb-input" id="lb-name-${e.id}" value="${safeName}" placeholder="e.g. World Rule / Character Lore">
          </div>
          <div class="lb-field" style="flex:0 0 80px">
            <label class="lb-label">Order</label>
            <input class="lb-input" type="number" id="lb-order-${e.id}" value="${e.insertion_order||100}" min="0" max="999">
          </div>
        </div>

        <div class="lb-field">
          <label class="lb-label">🔑 Primary Keys（逗號分隔，任一關鍵字觸發）</label>
          <input class="lb-input" id="lb-keys-${e.id}" value="${safeKeys}" placeholder="keyword1, keyword2, 角色名, ...">
        </div>
        <div class="lb-field">
          <label class="lb-label">🔗 Secondary Keys（Selective 模式需同時匹配）</label>
          <input class="lb-input" id="lb-sec-${e.id}" value="${safeSecKeys}" placeholder="secondary1, secondary2">
        </div>

        <div class="lb-field">
          <label class="lb-label">📄 Content（注入 context 的世界資訊內容）</label>
          <textarea class="lb-textarea" id="lb-content-${e.id}" placeholder="在這裡輸入要注入的世界觀、設定、規則...">${safeContent}</textarea>
        </div>

        <div class="lb-field">
          <label class="lb-label">💬 Comment（個人備註，不注入）</label>
          <input class="lb-input" id="lb-comment-${e.id}" value="${safeComment}" placeholder="自用備註，不影響 AI">
        </div>

        <div class="lb-row-2col" style="gap:0.6rem;">
          <div class="lb-field">
            <label class="lb-label">📍 Position（注入位置）</label>
            <select class="lb-select" id="lb-pos-${e.id}">
              <option value="before_char" ${(e.position||'before_char')==='before_char'?'selected':''}>↑ 角色描述之前</option>
              <option value="after_char" ${e.position==='after_char'?'selected':''}>↓ 角色描述之後</option>
              <option value="before_prompt" ${e.position==='before_prompt'?'selected':''}>↑ System Prompt 之前</option>
              <option value="at_depth" ${e.position==='at_depth'?'selected':''}>@ Depth (Author's Note)</option>
            </select>
          </div>
          <div class="lb-field" style="flex:0 0 90px">
            <label class="lb-label">🔍 Scan Depth</label>
            <input class="lb-input" type="number" id="lb-depth-${e.id}" value="${e.scan_depth||4}" min="1" max="200">
          </div>
          <div class="lb-field" style="flex:0 0 90px">
            <label class="lb-label">💎 Token Budget</label>
            <input class="lb-input" type="number" id="lb-budget-${e.id}" value="${e.token_budget||400}" min="0" max="8192">
          </div>
        </div>

        <div class="lb-flags-group">
          <label class="lb-checkbox-label" title="永遠注入，不需關鍵字觸發">
            <input type="checkbox" id="lb-const-${e.id}" ${e.constant?'checked':''}><span>∞ Constant（永遠注入）</span>
          </label>
          <label class="lb-checkbox-label" title="需同時匹配 Secondary Keys 才觸發">
            <input type="checkbox" id="lb-sel-${e.id}" ${e.selective?'checked':''}><span>◈ Selective（精確匹配）</span>
          </label>
          <label class="lb-checkbox-label" title="關鍵字區分大小寫">
            <input type="checkbox" id="lb-case-${e.id}" ${e.case_sensitive?'checked':''}><span>Aa Case Sensitive</span>
          </label>
        </div>

        <div style="display:flex;gap:0.5rem;margin-top:0.25rem;">
          <button class="lb-save-btn" onclick="lbSaveEntry('${e.id}')">✓ 儲存條目</button>
          <button class="lb-cancel-btn" onclick="lbCancelEdit()">取消</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

function toggleLorebookEntry(id) {
  lorebookEditId = lorebookEditId === id ? null : id;
  renderLorebookList();
  if (lorebookEditId === id) {
    setTimeout(() => document.getElementById('lb-entry-' + id)?.scrollIntoView({behavior:'smooth',block:'nearest'}), 60);
  }
}

function lbCancelEdit() { lorebookEditId = null; renderLorebookList(); }

function lbToggleEnabled(id, enabled) {
  const entries = _getLbStore();
  const e = entries.find(l => l.id === id);
  if (e) {
    e.enabled = enabled;
    _saveLbEntry(e);
    // Update toggle button visual immediately
    const btn = document.querySelector(`#lb-entry-${id} .lb-toggle`);
    if (btn) btn.classList.toggle('on', enabled);
    // Update lb-count
    renderLorebookCount();
  }
}

function renderLorebookCount() {
  const countEl = document.getElementById('lb-count');
  if (countEl) {
    const entries = _getLbStore();
    const total = entries.length;
    const enabled = entries.filter(e => e.enabled).length;
    countEl.textContent = `${enabled} / ${total} 條目啟用`;
  }
}

function lbSaveEntry(id) {
  const entries = _getLbStore();
  const e = entries.find(l => l.id === id);
  if (!e) return;
  e.name    = document.getElementById('lb-name-'+id)?.value.trim() || '';
  e.keys    = (document.getElementById('lb-keys-'+id)?.value||'').split(',').map(k=>k.trim()).filter(Boolean);
  e.secondary_keys = (document.getElementById('lb-sec-'+id)?.value||'').split(',').map(k=>k.trim()).filter(Boolean);
  e.content = document.getElementById('lb-content-'+id)?.value || '';
  e.comment = document.getElementById('lb-comment-'+id)?.value.trim() || '';
  e.position = document.getElementById('lb-pos-'+id)?.value || 'before_char';
  e.insertion_order = parseInt(document.getElementById('lb-order-'+id)?.value) || 100;
  e.scan_depth = parseInt(document.getElementById('lb-depth-'+id)?.value) || 4;
  e.token_budget = parseInt(document.getElementById('lb-budget-'+id)?.value) || 400;
  e.constant = document.getElementById('lb-const-'+id)?.checked || false;
  e.selective = document.getElementById('lb-sel-'+id)?.checked || false;
  e.case_sensitive = document.getElementById('lb-case-'+id)?.checked || false;
  e.keywords = e.keys; // backward compat
  _saveLbEntry(e);
  lorebookEditId = null;
  renderLorebookList();
  showToast('✓ 條目已儲存');
}

function addLorebookEntry() {
  const entry = {
    id: uid(), name: '', keys: [], keywords: [], secondary_keys: [], content: '',
    comment: '', enabled: true, constant: false, selective: false, case_sensitive: false,
    insertion_order: 100, position: 'before_char', scan_depth: 4, token_budget: 400
  };
  const store = _getLbStore();
  store.push(entry);
  _saveLbEntry(entry);
  lorebookEditId = entry.id;
  renderLorebookList();
  setTimeout(() => {
    document.getElementById('lb-entry-'+entry.id)?.scrollIntoView({behavior:'smooth',block:'nearest'});
    document.getElementById('lb-name-'+entry.id)?.focus();
  }, 60);
}

function toggleLorebook(id, enabled) { lbToggleEnabled(id, enabled); }

function deleteLorebook(id) {
  if (!confirm('確認刪除此條目？')) return;
  _deleteLbEntry(id);
  if (lorebookEditId === id) lorebookEditId = null;
  renderLorebookList();
}

async function saveLorebook() {
  if (lorebookEditId) lbSaveEntry(lorebookEditId);
  closeModal('lorebook-modal');
  showToast('✓ Lorebook 已儲存');
}

// ─── PERSONA ────────────────────────────────────────
function renderPersonaList() {
  const list = document.getElementById('persona-list');
  if (!list) return;
  if (!state.personas.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-light);font-size:0.82rem;padding:1.5rem;">還沒有 Persona — 點擊「＋ 新增」建立</div>';
    return;
  }
  list.innerHTML = state.personas.map(p => {
    const isImg = p.avatar?.startsWith('http') || p.avatar?.startsWith('data:');
    const avEl = isImg ? `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;">` : (p.avatar || '🎭');
    const boundChars = state.chars.filter(c => c.personaId === p.id);
    const boundHtml = boundChars.length
      ? boundChars.map(c => `<span style="font-size:0.68rem;background:rgba(201,184,232,0.3);color:var(--lavender);padding:0.15rem 0.5rem;border-radius:8px;">${c.name}</span>`).join('')
      : `<span style="font-size:0.68rem;color:var(--text-light);">未綁定角色</span>`;
    return `
      <div style="background:rgba(255,255,255,0.88);border-radius:16px;padding:0.9rem;border:1.5px solid rgba(201,184,232,0.2);display:flex;align-items:center;gap:0.9rem;">
        <div style="width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,var(--lavender),var(--milk-blue));display:flex;align-items:center;justify-content:center;font-size:1.6rem;overflow:hidden;flex-shrink:0;">${avEl}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:0.9rem;color:var(--text-dark);margin-bottom:0.2rem;">${p.name}</div>
          <div style="font-size:0.75rem;color:var(--text-light);margin-bottom:0.4rem;line-height:1.4;">${(p.desc||'').slice(0,60)}${(p.desc||'').length>60?'…':''}</div>
          <div style="display:flex;flex-wrap:wrap;gap:0.3rem;">${boundHtml}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.3rem;flex-shrink:0;">
          <button onclick="openEditPersonaPanel('${p.id}')" style="padding:0.3rem 0.6rem;background:var(--lavender-soft);border:1px solid var(--lavender-light);border-radius:8px;font-family:inherit;font-size:0.72rem;color:var(--text-mid);cursor:pointer;">編輯</button>
          <button onclick="deletePersona('${p.id}')" style="padding:0.3rem 0.6rem;background:none;border:1px solid rgba(232,120,120,0.3);border-radius:8px;font-family:inherit;font-size:0.72rem;color:#e87878;cursor:pointer;">刪除</button>
        </div>
      </div>`;
  }).join('');
}

let editingPersonaId = null;

function openAddPersonaPanel() {
  // Ensure the persona modal is open first
  const modal = document.getElementById('persona-modal');
  if (!modal.classList.contains('open')) {
    modal.classList.add('open');
    renderPersonaList();
  }
  editingPersonaId = null;
  document.getElementById('persona-panel-title').textContent = '＋ 新增 Persona';
  document.getElementById('persona-name-input').value = '';
  document.getElementById('persona-desc-input').value = '';
  document.getElementById('persona-avatar-preview').innerHTML = '🎭';
  delete document.getElementById('persona-avatar-file').dataset.base64;
  _renderPersonaCharCheckboxes(null);
  document.getElementById('persona-edit-panel').style.display = 'block';
  // Scroll edit panel into view
  setTimeout(() => {
    document.getElementById('persona-edit-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('persona-name-input')?.focus();
  }, 60);
}

function openEditPersonaPanel(id) {
  const p = state.personas.find(x => x.id === id);
  if (!p) return;
  editingPersonaId = id;
  document.getElementById('persona-panel-title').textContent = `✏️ 編輯：${p.name}`;
  document.getElementById('persona-name-input').value = p.name;
  document.getElementById('persona-desc-input').value = p.desc || '';
  const prev = document.getElementById('persona-avatar-preview');
  const isImg = p.avatar?.startsWith('http') || p.avatar?.startsWith('data:');
  prev.innerHTML = isImg ? `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;">` : (p.avatar || '🎭');
  if (p.avatar?.startsWith('data:')) document.getElementById('persona-avatar-file').dataset.base64 = p.avatar;
  else delete document.getElementById('persona-avatar-file').dataset.base64;
  _renderPersonaCharCheckboxes(id);
  document.getElementById('persona-edit-panel').style.display = 'block';
}

function _renderPersonaCharCheckboxes(personaId) {
  const box = document.getElementById('persona-char-checkboxes');
  if (!box) return;
  if (!state.chars.length) {
    box.innerHTML = '<span style="font-size:0.75rem;color:var(--text-light);">尚無角色</span>';
    return;
  }
  box.innerHTML = state.chars.map(c => {
    const isImg = c.avatar?.startsWith('http') || c.avatar?.startsWith('data:');
    const avEl = isImg ? `<img src="${c.avatar}" style="width:20px;height:20px;border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:4px;">` : `<span style="margin-right:4px;">${c.avatar||'🌸'}</span>`;
    const checked = personaId && c.personaId === personaId ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:0.3rem;padding:0.3rem 0.6rem;background:rgba(255,255,255,0.8);border:1px solid rgba(201,184,232,0.2);border-radius:10px;cursor:pointer;font-size:0.78rem;color:var(--text-dark);">
      <input type="checkbox" value="${c.id}" ${checked} style="accent-color:var(--lavender);">${avEl}${c.name}
    </label>`;
  }).join('');
}

function cancelPersonaEdit() {
  editingPersonaId = null;
  document.getElementById('persona-edit-panel').style.display = 'none';
}

function handlePersonaAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result;
    event.target.dataset.base64 = base64;
    const prev = document.getElementById('persona-avatar-preview');
    prev.innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover;">`;
  };
  reader.readAsDataURL(file);
}

async function savePersonaFromPanel() {
  const name = document.getElementById('persona-name-input').value.trim();
  if (!name) { showToast('請輸入名稱'); return; }
  const desc = document.getElementById('persona-desc-input').value.trim();
  const fileInput = document.getElementById('persona-avatar-file');
  const avatar = fileInput.dataset.base64 || '';

  // Get checked chars
  const checked = [...document.querySelectorAll('#persona-char-checkboxes input[type=checkbox]:checked')].map(i => i.value);

  if (editingPersonaId) {
    const p = state.personas.find(x => x.id === editingPersonaId);
    if (!p) return;
    p.name = name; p.desc = desc;
    if (avatar) p.avatar = avatar;
    await dbPut('personas', p);
    // Update char bindings
    for (const char of state.chars) {
      const wasLinked = char.personaId === editingPersonaId;
      const nowLinked = checked.includes(char.id);
      if (wasLinked !== nowLinked) {
        char.personaId = nowLinked ? editingPersonaId : null;
        await dbPut('chars', char);
      }
    }
    showToast('✓ Persona 已更新');
  } else {
    const p = { id: uid(), name, desc, avatar };
    state.personas.push(p);
    await dbPut('personas', p);
    // Bind selected chars
    for (const char of state.chars) {
      if (checked.includes(char.id)) {
        char.personaId = p.id;
        await dbPut('chars', char);
      }
    }
    showToast('✓ Persona 已建立');
  }

  cancelPersonaEdit();
  renderPersonaList();
  updateCharPersonaSelects();
  const allPersonaNames = state.personas.map(p => p.name).join('、');
  const dispEl = document.getElementById('persona-display');
  if (dispEl) dispEl.textContent = state.personas.length ? state.personas[0].name : '未設定';
}

async function addPersona() { openAddPersonaPanel(); }

async function deletePersona(id) {
  if (!confirm('確認刪除此 Persona？')) return;
  state.personas = state.personas.filter(p => p.id !== id);
  await dbDelete('personas', id);
  // Unlink chars
  for (const char of state.chars) {
    if (char.personaId === id) { char.personaId = null; await dbPut('chars', char); }
  }
  renderPersonaList();
  updateCharPersonaSelects();
}

// ─── CHARACTERS ─────────────────────────────────────
function renderCharsGrid() {
  const grid = document.getElementById('chars-grid');
  grid.innerHTML = '';

  state.chars.forEach(char => {
    const card = document.createElement('div');
    card.className = 'char-card';
    const avContent = isImgSrc(char.avatar)
      ? `<img src="${char.avatar}" alt="">` : (char.avatar || '🌸');
    card.innerHTML = `
      <div class="char-card-avatar">${avContent}</div>
      <div class="char-card-name">${char.name}</div>
      <div class="char-card-desc">${(char.desc||'').slice(0,30)}...</div>
    `;
    card.onclick = () => { state.activeCharId = char.id; showCharInfo(char.id); };
    grid.appendChild(card);
  });

  // Add button
  const addCard = document.createElement('div');
  addCard.className = 'char-add-card';
  addCard.innerHTML = '<div style="font-size:1.5rem">＋</div><div>新增角色</div>';
  addCard.onclick = () => openModal('add-char-modal');
  grid.appendChild(addCard);
}

async function saveChar() {
  const name = document.getElementById('char-name-input').value.trim();
  if (!name) { showToast('請輸入角色名稱'); return; }

  // 取得頭像：優先用上傳的 base64，其次 URL/emoji 輸入
  const avatarData = document.getElementById('char-avatar-input').dataset.base64 || '';
  const avatarText = document.getElementById('char-avatar-input').value.trim();
  const avatar = avatarData || avatarText || '🌸';

  if (state.editingCharId) {
    // ── 編輯模式 ──
    const char = state.chars.find(c => c.id === state.editingCharId);
    if (!char) return;
    char.name = name;
    char.avatar = avatar;
    char.desc = document.getElementById('char-desc-input').value.trim();
    char.firstMsg = document.getElementById('char-first-msg-input').value.trim();
    char.personaId = document.getElementById('char-persona-select').value || null;
    // 初始關係狀態 - 若有變更則也更新 relationship store
    const newRelLevel = document.getElementById('char-rel-select')?.value || 'stranger';
    if (!state.relationships[char.id]) state.relationships[char.id] = { level: 'stranger', score: 0, lastEvalAt: 0, lastScoreAt: 0 };
    state.relationships[char.id].level = newRelLevel;
    saveRelData(char.id);
    await dbPut('chars', char);
    state.editingCharId = null;
    closeModal('add-char-modal');
    document.getElementById('add-char-modal-title').textContent = '🌸 新增角色';
    document.getElementById('save-char-btn').textContent = '建立角色';
    renderCharsGrid();
    renderSidebar();
    updateSpellCharSelect();
    showToast('✓ 角色已更新');
    // 若目前聊天就是這個角色，刷新 header
    if (state.activeCharId === char.id) {
      const avatarDiv = document.getElementById('header-avatar');
      if (avatarDiv) avatarDiv.innerHTML = char.avatar?.startsWith('data:') || isImgSrc(char.avatar)
        ? `<img src="${char.avatar}" alt="">` : (char.avatar || '🌸');
      document.getElementById('header-name').textContent = char.name;
    }
  } else {
    // ── 新增模式 ──
    const initRelLevel = document.getElementById('char-rel-select')?.value || 'stranger';
    const char = {
      id: uid(),
      name,
      avatar,
      desc: document.getElementById('char-desc-input').value.trim(),
      firstMsg: document.getElementById('char-first-msg-input').value.trim(),
      personaId: document.getElementById('char-persona-select').value || null,
      createdAt: Date.now(),
    };
    state.chars.push(char);
    await dbPut('chars', char);
    // 設定初始關係
    state.relationships[char.id] = { level: initRelLevel, score: 0, lastEvalAt: 0, lastScoreAt: 0 };
    saveRelData(char.id);
    closeModal('add-char-modal');
    renderCharsGrid();
    renderSidebar();
    updateSpellCharSelect();
    showToast('✓ 角色已建立');
    await createNewChat(char.id);
  }
}

function showCharInfo(charId) {
  const char = state.chars.find(c => c.id === charId);
  if (!char) return;
  state.activeCharId = charId;
  const av = char.avatar;
  const avEl = document.getElementById('char-info-avatar');
  const isImg = av?.startsWith('http') || av?.startsWith('data:');
  avEl.innerHTML = isImg ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:24px;">` : (av || '🌸');
  document.getElementById('char-info-name').textContent = char.name;
  document.getElementById('char-info-desc').textContent = char.desc || '（無描述）';

  // Chats for this char
  const charChats = state.chats.filter(c => c.charId === charId);
  const chatsEl = document.getElementById('char-info-chats');
  chatsEl.innerHTML = charChats.length ? charChats.map(c => `
    <div onclick="openChat('${c.id}');closeModal('char-info-modal')" style="padding:0.6rem 0.8rem;background:var(--lavender-soft);border-radius:12px;cursor:pointer;font-size:0.85rem;color:var(--text-dark);">
      💬 ${c.title || '對話 ' + new Date(c.createdAt).toLocaleDateString('zh-TW')}
      <span style="font-size:0.72rem;color:var(--text-light);margin-left:0.3rem">${c.messages.length} 則訊息</span>
    </div>
  `).join('') : '<div style="text-align:center;color:var(--text-light);font-size:0.82rem;padding:1rem;">還沒有聊天記錄</div>';

  openModal('char-info-modal');
}

async function deleteChar(charId) {
  const char = state.chars.find(c => c.id === charId);
  if (!char) return;
  if (!confirm(`確認要刪除角色「${char.name}」？\n所有相關聊天記錄也會一併刪除，此操作無法復原。`)) return;

  // 刪除角色
  state.chars = state.chars.filter(c => c.id !== charId);
  await dbDelete('chars', charId);

  // 刪除所有相關聊天
  const relatedChats = state.chats.filter(c => c.charId === charId);
  for (const chat of relatedChats) {
    state.chats = state.chats.filter(c => c.id !== chat.id);
    await dbDelete('chats', chat.id);
    if (state.memory[chat.id]) {
      delete state.memory[chat.id];
      await dbDelete('memory', chat.id);
    }
  }

  // 若刪除的是目前開啟的角色，清空聊天畫面
  if (state.activeCharId === charId) {
    state.activeChat = null;
    state.activeCharId = null;
    document.getElementById('chat-header').style.display = 'none';
    document.getElementById('input-area').style.display = 'none';
    document.getElementById('messages-area').innerHTML = `<div class="empty-state" id="empty-chat"><div class="empty-state-icon">🌸</div><div class="empty-state-text">erhabene</div><div class="empty-state-sub">選擇一個角色開始對話，<br>或新增你的第一個角色卡</div></div>`;
  }

  closeModal('char-info-modal');
  renderCharsGrid();
  renderSidebar();
  updateSpellCharSelect();
  showToast(`✓ 角色「${char.name}」已刪除`);
}

function newChatWithChar() {
  if (!state.activeCharId) return;
  createNewChat(state.activeCharId);
  closeModal('char-info-modal');
}

function editChar(charId) {
  const id = charId || state.activeCharId;
  const char = state.chars.find(c => c.id === id);
  if (!char) return;
  state.editingCharId = id;
  closeModal('char-info-modal');

  // 切換 modal 標題和按鈕
  document.getElementById('add-char-modal-title').textContent = `✏️ 編輯角色：${char.name}`;
  document.getElementById('save-char-btn').textContent = '儲存修改';

  // 填入現有資料
  document.getElementById('char-name-input').value = char.name;
  const avatarInput = document.getElementById('char-avatar-input');
  avatarInput.value = char.avatar || '';
  delete avatarInput.dataset.base64; // 清除舊的 base64

  // 若是 base64 圖片，顯示預覽但不填入 input
  const preview = document.getElementById('char-avatar-preview');
  if (preview) {
    const isImg = char.avatar?.startsWith('data:') || isImgSrc(char.avatar);
    preview.innerHTML = isImg
      ? `<img src="${char.avatar}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;">`
      : `<span style="font-size:2rem">${char.avatar || '🌸'}</span>`;
    if (char.avatar?.startsWith('data:')) {
      avatarInput.value = '（已上傳圖片）';
      avatarInput.dataset.base64 = char.avatar;
    }
  }

  document.getElementById('char-desc-input').value = char.desc || '';
  document.getElementById('char-first-msg-input').value = char.firstMsg || '';
  const personaSel = document.getElementById('char-persona-select');
  if (personaSel) personaSel.value = char.personaId || '';
  // 填入目前關係狀態
  const relSel = document.getElementById('char-rel-select');
  if (relSel) relSel.value = getRelData(char.id).level || 'stranger';

  // 切換到手動建立 tab
  const manualTab = document.querySelector('#add-char-modal .modal-tab');
  if (manualTab) {
    document.querySelectorAll('#add-char-modal .modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#add-char-modal .modal-tab-content').forEach(t => t.classList.remove('active'));
    manualTab.classList.add('active');
    document.getElementById('char-manual').classList.add('active');
  }
  openModal('add-char-modal');
  // 編輯模式顯示刪除按鈕
  const deleteBtn = document.getElementById('delete-char-btn');
  if (deleteBtn) deleteBtn.style.display = '';
}

function deleteCharFromModal() {
  if (state.editingCharId) deleteChar(state.editingCharId);
}

function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('請選擇圖片檔案'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result; // data:image/png;base64,...
    const avatarInput = document.getElementById('char-avatar-input');
    avatarInput.value = '（已上傳圖片）';
    avatarInput.dataset.base64 = base64;
    const preview = document.getElementById('char-avatar-preview');
    if (preview) preview.innerHTML = `<img src="${base64}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;">`;
    showToast('✓ 頭像已載入');
  };
  reader.readAsDataURL(file);
}

async function importCharCard(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    if (file.name.endsWith('.json')) {
      const text = await file.text();
      const data = JSON.parse(text);
      parseSTCharCard(data);
    } else if (file.name.endsWith('.png')) {
      // Read PNG metadata (SillyTavern stores JSON in tEXt chunk)
      const buffer = await file.arrayBuffer();
      const jsonStr = extractPNGMetadata(buffer);
      if (jsonStr) {
        const data = JSON.parse(jsonStr);
        parseSTCharCard(data);
      } else {
        showToast('無法讀取 PNG 中的角色資料');
      }
    }
  } catch(e) {
    showToast('匯入失敗：' + e.message);
  }
}

function parseSTCharCard(data) {
  // Support SillyTavern v1 and v2 formats
  const char = data.data || data;
  document.getElementById('char-name-input').value = char.name || '';
  document.getElementById('char-avatar-input').value = char.avatar || '🌸';
  document.getElementById('char-desc-input').value =
    [char.description, char.personality, char.scenario].filter(Boolean).join('\n\n');
  document.getElementById('char-first-msg-input').value = char.first_mes || char.firstMessage || '';
  showToast('✓ 角色卡已讀取，請確認後儲存');
}

function extractPNGMetadata(buffer) {
  // Look for tEXt or iTXt chunk with "chara" keyword
  const bytes = new Uint8Array(buffer);
  let i = 8; // skip PNG signature
  while (i < bytes.length - 12) {
    // Read chunk length (big-endian 4 bytes)
    const chunkLen = (bytes[i]<<24 | bytes[i+1]<<16 | bytes[i+2]<<8 | bytes[i+3]) >>> 0;
    const chunkType = String.fromCharCode(bytes[i+4], bytes[i+5], bytes[i+6], bytes[i+7]);
    const dataStart = i + 8;
    const dataEnd = dataStart + chunkLen;

    if (chunkType === 'tEXt' || chunkType === 'iTXt') {
      // Find null separator between keyword and value
      let sep = dataStart;
      while (sep < dataEnd && bytes[sep] !== 0) sep++;
      const kw = String.fromCharCode(...bytes.slice(dataStart, sep));

      if (kw === 'chara') {
        let valueStart = sep + 1;
        // iTXt has extra headers: compression flag(1), compression method(1), language tag(\0), translated keyword(\0)
        if (chunkType === 'iTXt') {
          valueStart += 2; // skip compression flag & method
          while (valueStart < dataEnd && bytes[valueStart] !== 0) valueStart++; // skip language
          valueStart++;
          while (valueStart < dataEnd && bytes[valueStart] !== 0) valueStart++; // skip translated kw
          valueStart++;
        }
        // Get base64 string
        const b64 = String.fromCharCode(...bytes.slice(valueStart, dataEnd));
        try {
          // Decode base64 → binary → UTF-8 (fix Chinese garbled text)
          const binaryStr = atob(b64.trim());
          const binaryBytes = new Uint8Array(binaryStr.length);
          for (let k = 0; k < binaryStr.length; k++) binaryBytes[k] = binaryStr.charCodeAt(k);
          return new TextDecoder('utf-8').decode(binaryBytes);
        } catch(e) { return null; }
      }
    }
    // Move to next chunk: length(4) + type(4) + data(chunkLen) + crc(4)
    i = dataEnd + 4;
  }
  return null;
}

// ─── EXPORT ─────────────────────────────────────────
async function exportCharAsJson() {
  const char = state.chars.find(c => c.id === state.activeCharId);
  if (!char) return;
  const card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: char.name,
      description: char.desc,
      first_mes: char.firstMsg,
      avatar: 'none',
      tags: [],
      creator: 'erhabene',
    }
  };
  downloadJSON(card, char.name + '_card.json');
  closeModal('char-info-modal');
}

async function exportChatHistory() {
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  const char = state.chars.find(c => c.id === chat.charId);
  downloadJSON({ chat, char, exportedAt: new Date().toISOString() }, (char?.name || 'chat') + '_history.json');
}

async function exportChatAsST() {
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  const char = state.chars.find(c => c.id === chat.charId);
  const stFormat = {
    name: char?.name || 'Chat',
    chat: chat.messages.map(m => ({
      name: m.role === 'user' ? 'User' : (char?.name || 'AI'),
      is_user: m.role === 'user',
      is_system: false,
      send_date: new Date(m.time).toLocaleDateString('en-US'),
      mes: m.content,
    }))
  };
  downloadJSON(stFormat, (char?.name || 'chat') + '_st_export.json');
}

async function exportBackup() {
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    chars: state.chars,
    chats: state.chats,
    personas: state.personas,
    lorebook: state.lorebook,
    socialPosts: state.socialPosts,
    memory: state.memory,
    diaryEntries: state.diaryEntries,
    settings: {
      systemPrompt: state.systemPrompt,
      jailbreak: state.jailbreak,
      jailbreakPosition: state.jailbreakPosition,
      regexRules: state.regexRules,
    }
  };
  downloadJSON(backup, 'erhabene_backup_' + new Date().toISOString().slice(0,10) + '.json');
  showToast('✓ 備份已下載');
}

async function importBackup() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!confirm('確認要匯入備份？這將覆蓋現有資料。')) return;

      state.chars = data.chars || [];
      state.chats = data.chats || [];
      state.personas = data.personas || [];
      state.lorebook = data.lorebook || [];
      state.socialPosts = data.socialPosts || [];
      state.memory = data.memory || {};
      state.diaryEntries = data.diaryEntries || {};
      if (data.settings) {
        state.systemPrompt = data.settings.systemPrompt || state.systemPrompt;
        state.jailbreak = data.settings.jailbreak || '';
        state.jailbreakPosition = data.settings.jailbreakPosition || 'before_last';
        state.regexRules = data.settings.regexRules || '';
      }

      // Save all to DB
      await Promise.all([
        ...state.chars.map(c => dbPut('chars', c)),
        ...state.chats.map(c => dbPut('chats', c)),
        ...state.personas.map(p => dbPut('personas', p)),
        ...state.lorebook.map(l => dbPut('lorebook', l)),
        ...state.socialPosts.map(s => dbPut('socialPosts', s)),
      ]);

      renderCharsGrid(); renderSidebar(); renderSocialFeed();
      showToast('✓ 備份已匯入');
    } catch(err) { showToast('匯入失敗：' + err.message); }
  };
  input.click();
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── SPELL (小劇場) ─────────────────────────────────
// 小劇場面板已移除，功能統一至咒語舞台(cctv)分頁
function updateSpellCharSelect() { /* no-op, spell panel removed */ }

// ─── SOCIAL ─────────────────────────────────────────
// ─── SOCIAL CHAR FILTER ────────────────────────────
let currentSocialCharFilter = 'all';

function renderSocialCharTabs() {
  const el = document.getElementById('social-char-tabs');
  if (!el) return;
  const items = [
    { id: 'all',  label: '🌊 全部' },
    { id: 'mine', label: '📝 我的' },
    ...state.chars.map(c => ({ id: c.id, label: c.name, avatar: c.avatar })),
  ];
  el.innerHTML = items.map(it => {
    const act = it.id === currentSocialCharFilter ? ' active' : '';
    let avHtml = '';
    if (it.avatar !== undefined) {
      avHtml = `<span class="cft-av">${isImgSrc(it.avatar)?`<img src="${it.avatar}">`:( it.avatar||'🌸')}</span>`;
    }
    return `<button class="cft-btn${act}" onclick="switchSocialCharTab('${it.id}')">${avHtml}${it.label}</button>`;
  }).join('');
}

function switchSocialCharTab(id) {
  currentSocialCharFilter = id;
  renderSocialCharTabs();
  renderSocialFeed();
}

function renderSocialFeed() {
  renderSocialCharTabs();
  const feed = document.getElementById('social-feed');
  let posts = [...state.socialPosts].sort((a, b) => b.time - a.time);
  if (currentSocialCharFilter === 'mine') {
    posts = posts.filter(p => !p.charId);
  } else if (currentSocialCharFilter !== 'all') {
    posts = posts.filter(p => p.charId === currentSocialCharFilter);
  }

  let html = '';

  // Compose area
  html += `
    <div class="post-compose">
      <textarea class="compose-input" id="compose-input" placeholder="分享這一刻..."></textarea>
      <div class="compose-actions">
        <select class="compose-char-select" id="compose-char-sel">
          <option value="user">以自己發文</option>
          ${state.chars.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
        <div style="display:flex;gap:0.4rem;">
          <button class="compose-post-btn" style="background:var(--lavender-soft);color:var(--text-mid);border:1px solid var(--lavender-light);" onclick="openModal('social-compose-modal');document.getElementById('social-compose-title').textContent='✦ 讓角色發文'">AI發文</button>
          <button class="compose-post-btn" onclick="userPostSocial()">發布</button>
        </div>
      </div>
    </div>
  `;

  if (posts.length === 0) {
    html += `<div class="empty-state"><div class="empty-state-icon">🌊</div><div class="empty-state-text">還沒有貼文<br>讓角色來發第一篇吧</div></div>`;
  } else {
    html += '<div class="plurk-timeline">';
    posts.forEach(post => {
        const char = state.chars.find(c => c.id === post.charId);
        const av = char?.avatar;
        const avHtml = isImgSrc(av) ? `<img src="${av}">` : (av || '🌊');
        html += `
          <div class="plurk-item">
            <div class="plurk-dot"></div>
            <div class="post-card">
              <div class="post-header">
                <div class="post-avatar">${avHtml}</div>
                <div>
                  <div class="post-author">${post.authorName || char?.name || 'User'}</div>
                  <div class="post-time">${formatTime(post.time)}</div>
                </div>
              </div>
              <div class="post-content">${post.content}</div>
              ${post.imageUrl ? `<div class="post-image"><img src="${post.imageUrl}" onclick="previewImage('${post.imageUrl}')" loading="lazy"></div>` : ''}
              <div class="post-actions">
                <button class="post-action-btn" onclick="likePost('${post.id}')">💜 ${post.likes || 0}</button>
                <button class="post-action-btn" onclick="replyToPost('${post.id}')">💬 ${(post.comments||[]).length}</button>
                <button class="post-action-btn" onclick="deletePost('${post.id}')">🗑️</button>
              </div>
              ${renderComments(post)}
              <div id="reply-area-${post.id}" style="display:none;margin-top:0.5rem;">
                <div style="display:flex;gap:0.4rem;">
                  <input id="reply-input-${post.id}" placeholder="回覆..." style="flex:1;padding:0.4rem 0.7rem;border:1px solid var(--lavender-light);border-radius:10px;font-family:inherit;font-size:0.82rem;outline:none;background:var(--lavender-soft);">
                  <button onclick="submitReply('${post.id}')" style="padding:0.4rem 0.7rem;background:var(--lavender);border:none;border-radius:10px;color:white;font-family:inherit;font-size:0.78rem;cursor:pointer;">回覆</button>
                </div>
              </div>
            </div>
          </div>
        `;
    });
    html += '</div>';
  }

  feed.innerHTML = html;
}

function renderComments(post) {
  if (!post.comments?.length) return '';
  return `<div class="post-comments">${post.comments.map(c => {
    const char = state.chars.find(ch => ch.id === c.charId);
    const av = char?.avatar;
    const avHtml = isImgSrc(av) ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover;">` : (av || '💬');
    const isUserComment = !c.charId;
    const editBtn = isUserComment
      ? `<button class="cmt-act-btn" onclick="editComment('${post.id}','${c.id}')">✏️ 編輯</button>`
      : '';
    const delBtn = `<button class="cmt-act-btn del" onclick="deleteComment('${post.id}','${c.id}')">🗑️ 刪除</button>`;
    return `
      <div class="comment-item" data-cid="${c.id}">
        <div class="comment-avatar">${avHtml}</div>
        <div class="comment-body">
          <div class="comment-bubble">
            <div class="comment-name">${c.authorName || char?.name || 'User'}</div>
            <span id="ctxt-${c.id}">${c.content}</span>
          </div>
          <div class="comment-actions">${editBtn}${delBtn}</div>
        </div>
      </div>`;
  }).join('')}</div>`;
}

async function userPostSocial() {
  const content = document.getElementById('compose-input').value.trim();
  if (!content) return;
  const charId = document.getElementById('compose-char-sel').value;
  const char = charId !== 'user' ? state.chars.find(c => c.id === charId) : null;

  const post = {
    id: uid(),
    charId: char?.id || null,
    platform: 'social',
    content,
    authorName: char?.name || 'You',
    imageUrl: null,
    likes: 0,
    comments: [],
    time: Date.now(),
  };

  state.socialPosts.push(post);
  await dbPut('socialPosts', post);
  document.getElementById('compose-input').value = '';
  renderSocialFeed();
  // user 自己發文時，所有角色自動留言
  if (!char && state.chars.length) {
    setTimeout(() => allCharsReplyToPost(post.id), 1500);
  }
}

function socialUpdatePersonaInfo() {
  const charId = document.getElementById('social-post-char-select')?.value;
  const infoEl = document.getElementById('social-persona-info');
  const nameEl = document.getElementById('social-persona-name-display');
  if (!charId || !infoEl) return;
  const char = state.chars.find(c => c.id === charId);
  const persona = char?.personaId ? state.personas.find(p => p.id === char.personaId) : null;
  if (persona) {
    infoEl.style.display = 'flex';
    nameEl.textContent = `Persona：${persona.name}${persona.desc ? ' — ' + persona.desc.slice(0, 60) : ''}`;
  } else {
    infoEl.style.display = 'none';
  }
}

function socialToggleImageStyleField() {
  // placeholder for future expansion
}

// Build social image prompt based on option key
function buildSocialImagePrompt(option, char, persona, postContent) {
  const charDesc = char.desc?.slice(0, 150) || '';
  const sceneHint = postContent?.slice(0, 200) || '';
  const isDuo = option.startsWith('duo');
  const isSelfie = option.startsWith('selfie');

  const styleMap = {
    solo_anime:      'anime illustration, soft cel shading, clean lineart, expressive eyes',
    solo_watercolor: 'soft watercolor illustration, pastel palette, loose brushwork, dreamy atmosphere',
    solo_chibi:      'chibi kawaii style, super deformed proportions, big round eyes, cute and soft',
    duo_anime:       'anime illustration, two characters side by side, warm soft lighting, expressive',
    duo_watercolor:  'soft watercolor illustration, two characters together, pastel tones, gentle mood',
    selfie_anime:    'anime style close-up, character holding phone, cheerful expression, from above angle',
    auto:            'anime illustration, detailed background, dynamic composition, vibrant but soft colors',
  };
  const styleDesc = styleMap[option] || styleMap.auto;

  // Always attach ref note if any image available (not just duo)
  const hasRef = char.avatar?.startsWith('data:') || (isDuo && persona?.avatar?.startsWith('data:'));
  const refNote = hasRef
    ? 'IMPORTANT: Use the provided reference image(s) to maintain exact character appearance and design. '
    : '';

  // Dynamic scene from post content — never hardcoded
  const sceneDesc = sceneHint
    ? `Scene/mood derived from this text (do NOT include any text in the image): "${sceneHint}"`
    : `A moment in ${char.name}'s daily life`;

  const charPart = `${char.name}${charDesc ? ` (${charDesc})` : ''}`;
  const personaPart = isDuo && persona
    ? ` together with ${persona.name}${persona.desc ? ` (${persona.desc.slice(0,80)})` : ''}`
    : '';
  const viewPart = isSelfie ? 'POV selfie composition, character looking directly at viewer. ' : '';

  return `${refNote}Style: ${styleDesc}. ${viewPart}Characters: ${charPart}${personaPart}. ${sceneDesc}. NOT photorealistic. NOT a photograph. Pure illustrated art only. No text, no watermarks, no logos.`;
}

async function aiPostSocial() {
  const charId = document.getElementById('social-post-char-select').value;
  const promptText = document.getElementById('social-post-prompt').value.trim();
  const imageOption = document.getElementById('social-image-option').value;
  const socialModelOverride = document.getElementById('social-model-input')?.value?.trim();

  const char = state.chars.find(c => c.id === charId);
  if (!char) { showToast('請選擇角色'); return; }

  // Resolve model: use social override if set, else main state.model
  const modelToUse = socialModelOverride || getModel('social');

  // Get persona bound to this char
  const persona = char.personaId ? state.personas.find(p => p.id === char.personaId) : null;

  // Get recent chat messages for this char (from main chat, read-only — won't affect main chat)
  const charChats = state.chats.filter(c => c.charId === char.id);
  const recentMsgs = charChats
    .flatMap(c => c.messages)
    .sort((a, b) => b.time - a.time)
    .slice(0, 20)
    .reverse()
    .map(m => `${m.role === 'user' ? (persona?.name || 'User') : char.name}: ${m.content}`)
    .join('\n');

  // Get memories for all this char's chats
  const memTexts = charChats
    .flatMap(c => state.memory[c.id] || [])
    .map(m => `[${m.category}] ${m.text}`)
    .join('\n');

  closeModal('social-compose-modal');
  showToast('✍️ 角色正在發文...');

  try {
    // ── Build rich system + user prompt ──
    const platformName = '動態廣場';
    const systemPrompt = `你是 ${char.name}。
${char.desc ? `[角色設定]\n${char.desc}` : ''}
${persona ? `\n[Persona - 你正在和 ${persona.name} 說話]\n${persona.desc || ''}` : ''}
${memTexts ? `\n[與對方的共同記憶]\n${memTexts}` : ''}`;

    const userPrompt = `請以第一人稱，用繁體中文，在 ${platformName} 上發一篇貼文。
${promptText ? `主題方向：${promptText}` : '根據你的個性與最近的生活自由發揮。'}

${recentMsgs ? `[最近的對話記錄供參考，融入情緒與感受但不要直接引用]\n${recentMsgs}\n` : ''}

字數至少400字，上限600字，語氣自然真實，有個人色彩與情感細節，像真人在分享生活，有起伏有細節不要虎頭蛇尾。
只輸出貼文正文，不要加標題、作者名或任何說明。`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 4096 }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'API error ' + res.status);
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '（無法生成貼文）';

    // ── Image generation ──
    let imageUrl = null;
    if (imageOption !== 'none') {
      try {
        const refImages = [];
        // Always attach char avatar as reference for ALL image options
        const charRef = getAvatarRef(char.avatar);
        if (charRef) refImages.push(charRef);
        // For duo options, also attach persona avatar
        if (imageOption.startsWith('duo') && persona?.avatar) {
          const personaRef = getAvatarRef(persona.avatar);
          if (personaRef) refImages.push(personaRef);
        }
        const imgPrompt = buildSocialImagePrompt(imageOption, char, persona, content);
        console.log('[Social Image] refImages count:', refImages.length, '| prompt:', imgPrompt.slice(0,120));
        imageUrl = await callGeminiImage(imgPrompt, refImages);
      } catch(e) {
        console.warn('Social image gen failed:', e.message, e);
        showToast('⚠️ 圖片生成失敗：' + e.message);
      }
    }

    const post = {
      id: uid(),
      charId: char.id,
      platform: 'social',
      content,
      authorName: char.name,
      imageUrl,
      likes: 0,
      comments: [],
      time: Date.now(),
    };
    state.socialPosts.push(post);
    await dbPut('socialPosts', post);
    renderSocialFeed();
    showToast('✓ 貼文已發布');
  } catch(err) {
    showToast('發文失敗：' + err.message);
  }
}

async function submitReply(postId) {
  const input = document.getElementById('reply-input-' + postId);
  const content = input?.value?.trim();
  if (!content) return;

  const post = state.socialPosts.find(p => p.id === postId);
  if (!post) return;

  post.comments = post.comments || [];
  post.comments.push({
    id: uid(),
    charId: null,
    authorName: 'You',
    content,
    time: Date.now(),
  });
  await dbPut('socialPosts', post);
  renderSocialFeed();

  // AI chars respond to user comment
  if (state.chars.length) {
    setTimeout(() => aiReplyToComment(postId, content), 2000);
  }
}

// ─── Comment CRUD ───────────────────────────────────
function editComment(postId, commentId) {
  const spanEl = document.getElementById('ctxt-' + commentId);
  if (!spanEl) return;
  const bubble = spanEl.closest('.comment-bubble');
  const body   = spanEl.closest('.comment-body');
  const orig   = spanEl.textContent;
  spanEl.style.display = 'none';
  bubble.insertAdjacentHTML('beforeend',
    `<textarea class="cmt-edit-ta" id="ceta-${commentId}" rows="2">${orig}</textarea>` +
    `<div class="cmt-edit-row">` +
      `<button class="cmt-edit-save" onclick="saveComment('${postId}','${commentId}')">✓ 儲存</button>` +
      `<button class="cmt-edit-cancel" onclick="cancelEditComment()">取消</button>` +
    `</div>`
  );
  const ta = document.getElementById('ceta-' + commentId);
  if (ta) { ta.focus(); ta.style.height = ta.scrollHeight + 'px'; }
  body.querySelector('.comment-actions').style.display = 'none';
}
async function saveComment(postId, commentId) {
  const ta = document.getElementById('ceta-' + commentId);
  if (!ta) return;
  const txt = ta.value.trim();
  if (!txt) return;
  const post = state.socialPosts.find(p => p.id === postId);
  const c    = post?.comments?.find(c => c.id === commentId);
  if (!c) return;
  c.content = txt;
  await dbPut('socialPosts', post);
  renderSocialFeed();
  showToast('✓ 留言已更新');
}
function cancelEditComment() { renderSocialFeed(); }
async function deleteComment(postId, commentId) {
  if (!confirm('確認刪除此留言？')) return;
  const post = state.socialPosts.find(p => p.id === postId);
  if (!post) return;
  post.comments = (post.comments || []).filter(c => c.id !== commentId);
  await dbPut('socialPosts', post);
  renderSocialFeed();
  showToast('🗑️ 留言已刪除');
}

// ─── AI 留言回覆 ─────────────────────────────────────
// user 發貼文 → 所有角色都來留言
async function allCharsReplyToPost(postId) {
  const post = state.socialPosts.find(p => p.id === postId);
  if (!post) return;
  const chars = [...state.chars];
  for (let i = 0; i < chars.length; i++) {
    await new Promise(r => setTimeout(r, i * 1800));
    const char = chars[i];
    try {
      const persona = char.personaId ? state.personas.find(p => p.id === char.personaId) : null;
      const p2 = state.socialPosts.find(p => p.id === postId); // 重新取（可能已更新）
      if (!p2) return;
      const prompt = `你是 ${char.name}。${char.desc ? char.desc.slice(0,200) : ''}
有人在社群平台發文：「${p2.content.slice(0,300)}」
${persona ? `你在和 ${persona.name} 說話。` : ''}請用繁體中文寫一則自然留言（1-2句），語氣符合個性。只輸出留言內容。`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('socialComment')}:generateContent?key=${state.apiKey}`;
      const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{maxOutputTokens:3000} })
      });
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (reply) {
        const p3 = state.socialPosts.find(p => p.id === postId);
        if (!p3) return;
        p3.comments.push({ id: uid(), charId: char.id, authorName: char.name, content: reply, time: Date.now() });
        await dbPut('socialPosts', p3);
        renderSocialFeed();
      }
    } catch(e) { /* silent */ }
  }
}

async function aiReplyToComment(postId, userComment) {
  const post = state.socialPosts.find(p => p.id === postId);
  if (!post) return;
  // 若是 user 自己的貼文，讓所有角色回；否則只讓該貼文角色回
  const charsToReply = post.charId
    ? [state.chars.find(c => c.id === post.charId)].filter(Boolean)
    : state.chars;
  for (let i = 0; i < charsToReply.length; i++) {
    await new Promise(r => setTimeout(r, i * 1800));
    const char = charsToReply[i];
    try {
      const persona = char.personaId ? state.personas.find(p => p.id === char.personaId) : null;
      const p2 = state.socialPosts.find(p => p.id === postId);
      if (!p2) return;
      const prompt = `你是 ${char.name}。${char.desc ? char.desc.slice(0,200) : ''}
貼文：「${p2.content.slice(0,300)}」
${persona ? `你在和 ${persona.name} 說話。` : ''}有人留言：「${userComment}」
請用繁體中文回應（1-2句），語氣符合個性。只輸出回覆內容。`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('socialComment')}:generateContent?key=${state.apiKey}`;
      const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{maxOutputTokens:3000} })
      });
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (reply) {
        const p3 = state.socialPosts.find(p => p.id === postId);
        if (!p3) return;
        p3.comments.push({ id: uid(), charId: char.id, authorName: char.name, content: reply, time: Date.now() });
        await dbPut('socialPosts', p3);
        renderSocialFeed();
      }
    } catch(e) { /* silent */ }
  }
}

async function likePost(postId) {
  const post = state.socialPosts.find(p => p.id === postId);
  if (!post) return;
  post.likes = (post.likes || 0) + 1;
  await dbPut('socialPosts', post);
  renderSocialFeed();
}

function replyToPost(postId) {
  const area = document.getElementById('reply-area-' + postId);
  if (area) {
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
    if (area.style.display === 'block') area.querySelector('input')?.focus();
  }
}

async function deletePost(postId) {
  if (!confirm('確認刪除這篇貼文？')) return;
  state.socialPosts = state.socialPosts.filter(p => p.id !== postId);
  await dbDelete('socialPosts', postId);
  renderSocialFeed();
}

function openSocialCompose() {
  // Fill char options
  const sel = document.getElementById('social-post-char-select');
  sel.innerHTML = state.chars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  openModal('social-compose-modal');
}

// ─── DIARY ──────────────────────────────────────────
function initDiary() {
  renderDiaryCharTabs();
  renderDiaryCalendar();
  const label = document.getElementById('diary-month-label');
  label.textContent = state.diaryMonth.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' });
}

function renderDiaryCharTabs() {
  const el = document.getElementById('diary-char-tabs');
  if (!el) return;
  const items = [
    { id: 'all', label: '📔 全部' },
    ...state.chars.map(c => ({ id: c.id, label: c.name, avatar: c.avatar })),
  ];
  el.innerHTML = items.map(it => {
    const act = it.id === state.diaryCharFilter ? ' active' : '';
    let avHtml = '';
    if (it.avatar !== undefined) {
      avHtml = `<span class="cft-av">${isImgSrc(it.avatar)?`<img src="${it.avatar}">`:( it.avatar||'🌸')}</span>`;
    }
    return `<button class="cft-btn${act}" onclick="switchDiaryCharTab('${it.id}')">${avHtml}${it.label}</button>`;
  }).join('');
}

function switchDiaryCharTab(id) {
  state.diaryCharFilter = id;
  renderDiaryCharTabs();
  if (state.selectedDiaryDate) loadDiaryForDate(state.selectedDiaryDate);
}

function changeMonth(dir) {
  const d = new Date(state.diaryMonth);
  d.setMonth(d.getMonth() + dir);
  state.diaryMonth = d;
  initDiary();
}

function renderDiaryCalendar() {
  const cal = document.getElementById('diary-calendar');
  const month = state.diaryMonth;
  const year = month.getFullYear();
  const mon = month.getMonth();

  const firstDay = new Date(year, mon, 1).getDay();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const today = new Date();

  let html = ['日','一','二','三','四','五','六'].map(d => `<div class="cal-day-name">${d}</div>`).join('');

  // Empty cells
  for (let i = 0; i < firstDay; i++) html += '<div></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(mon+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = today.getFullYear()===year && today.getMonth()===mon && today.getDate()===d;
    const isSelected = state.selectedDiaryDate === dateStr;
    const hasEntry = Object.values(state.diaryEntries).some(entries => entries && entries[dateStr]);
    html += `<div class="cal-day${isToday?' today':''}${isSelected?' selected':''}${hasEntry?' has-entry':''}" onclick="selectDiaryDate('${dateStr}')">${d}</div>`;
  }

  cal.innerHTML = html;
  document.getElementById('diary-month-label').textContent = month.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' });
}

async function selectDiaryDate(dateStr) {
  state.selectedDiaryDate = dateStr;
  renderDiaryCalendar();
  await loadDiaryForDate(dateStr);
}

async function loadDiaryForDate(dateStr) {
  const content = document.getElementById('diary-content');

  // Check if we have entries for this date（套用角色篩選）
  const entries = [];
  const charsToShow = state.diaryCharFilter === 'all'
    ? state.chars
    : state.chars.filter(c => c.id === state.diaryCharFilter);
  charsToShow.forEach(char => {
    const charEntries = state.diaryEntries[char.id] || {};
    if (charEntries[dateStr]) {
      entries.push({ char, content: charEntries[dateStr] });
    }
  });

  if (entries.length) {
    content.innerHTML = entries.map(e => {
      const av = e.char.avatar;
      const avHtml = isImgSrc(av) ? `<img src="${av}">` : (av || '🌸');
      const safeText = e.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `
        <div class="diary-entry" style="margin-bottom:1rem;">
          <div class="diary-entry-header">
            <div class="diary-entry-date">${new Date(dateStr).toLocaleDateString('zh-TW', {year:'numeric',month:'long',day:'numeric'})}</div>
            <button class="diary-regen-btn" onclick="regenDiary('${dateStr}','${e.char.id}')" title="重新生成">🔄 重新生成</button>
          </div>
          <div class="diary-entry-char">
            <div class="diary-char-avatar">${avHtml}</div>
            <div class="diary-char-name">${e.char.name} 的日記</div>
          </div>
          <div class="diary-entry-text">${safeText}</div>
        </div>
      `;
    }).join('');
    return;
  }

  // No entry — offer to generate
  if (state.chars.length === 0) {
    content.innerHTML = '<div class="diary-empty">先建立角色才能查看日記</div>';
    return;
  }

  // Build character checkboxes for selection
  const charCheckboxesHtml = state.chars.map(c => {
    const avHtmlStr = isImgSrc(c.avatar)
      ? `<img src="${c.avatar}" style="width:22px;height:22px;border-radius:7px;object-fit:cover;vertical-align:middle;margin-right:4px;">`
      : `<span style="margin-right:4px;">${c.avatar || '🌸'}</span>`;
    return `<label style="display:flex;align-items:center;gap:0.3rem;padding:0.3rem 0.6rem;background:rgba(255,255,255,0.8);border:1px solid rgba(201,184,232,0.2);border-radius:10px;cursor:pointer;font-size:0.8rem;color:var(--text-dark);">
      <input type="checkbox" class="diary-char-check" value="${c.id}" checked style="accent-color:var(--lavender);">${avHtmlStr}${c.name}
    </label>`;
  }).join('');

  content.innerHTML = `
    <div style="text-align:center;padding:2rem 1rem;">
      <div style="font-size:1.5rem;margin-bottom:0.8rem;">📔</div>
      <div style="font-size:0.88rem;color:var(--text-mid);margin-bottom:1.2rem;">${dateStr} 的日記尚未生成</div>
      <div style="margin-bottom:1rem;text-align:left;">
        <div style="font-size:0.75rem;color:var(--text-light);margin-bottom:0.5rem;letter-spacing:0.05em;text-align:center;">選擇要生成日記的角色</div>
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem;justify-content:center;" id="diary-char-picker">
          ${charCheckboxesHtml}
        </div>
      </div>
      <div style="margin-bottom:1.2rem;">
        <div style="font-size:0.75rem;color:var(--text-light);margin-bottom:0.5rem;letter-spacing:0.05em;">選擇文風</div>
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem;justify-content:center;" id="diary-style-picker">
          <button onclick="setDiaryStyle('default',this)" class="diary-style-btn active" data-style="default">📖 自然真摯</button>
          <button onclick="setDiaryStyle('dark',this)" class="diary-style-btn" data-style="dark">🌑 陰暗憂鬱</button>
          <button onclick="setDiaryStyle('spicy',this)" class="diary-style-btn" data-style="spicy">🔥 色色曖昧</button>
          <button onclick="setDiaryStyle('sunny',this)" class="diary-style-btn" data-style="sunny">☀️ 陽光開朗</button>
          <button onclick="setDiaryStyle('cute',this)" class="diary-style-btn" data-style="cute">🌸 輕鬆可愛</button>
        </div>
      </div>
      <button onclick="generateDiary('${dateStr}')" style="padding:0.7rem 1.8rem;background:linear-gradient(135deg,var(--lavender),var(--milk-blue));border:none;border-radius:14px;color:white;font-family:inherit;font-size:0.88rem;cursor:pointer;font-weight:500;">✨ 生成日記</button>
    </div>
  `;
}

async function regenDiary(dateStr, charId) {
  // 清空舊日記並顯示帶文風選擇的重新生成 UI
  if (state.diaryEntries[charId]) {
    delete state.diaryEntries[charId][dateStr];
  }
  const content = document.getElementById('diary-content');
  content.innerHTML = `
    <div style="text-align:center;padding:2rem 1rem;">
      <div style="font-size:1.5rem;margin-bottom:0.8rem;">🔄</div>
      <div style="font-size:0.88rem;color:var(--text-mid);margin-bottom:1.2rem;">重新生成 ${dateStr} 的日記</div>
      <div style="margin-bottom:1.2rem;">
        <div style="font-size:0.75rem;color:var(--text-light);margin-bottom:0.5rem;letter-spacing:0.05em;">選擇文風</div>
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem;justify-content:center;" id="diary-style-picker">
          <button onclick="setDiaryStyle('default',this)" class="diary-style-btn ${state.diaryStyle==='default'?'active':''}" data-style="default">📖 自然真摯</button>
          <button onclick="setDiaryStyle('dark',this)" class="diary-style-btn ${state.diaryStyle==='dark'?'active':''}" data-style="dark">🌑 陰暗憂鬱</button>
          <button onclick="setDiaryStyle('spicy',this)" class="diary-style-btn ${state.diaryStyle==='spicy'?'active':''}" data-style="spicy">🔥 色色曖昧</button>
          <button onclick="setDiaryStyle('sunny',this)" class="diary-style-btn ${state.diaryStyle==='sunny'?'active':''}" data-style="sunny">☀️ 陽光開朗</button>
          <button onclick="setDiaryStyle('cute',this)" class="diary-style-btn ${state.diaryStyle==='cute'?'active':''}" data-style="cute">🌸 輕鬆可愛</button>
        </div>
      </div>
      <button onclick="generateDiary('${dateStr}')" style="padding:0.7rem 1.8rem;background:linear-gradient(135deg,var(--lavender),var(--milk-blue));border:none;border-radius:14px;color:white;font-family:inherit;font-size:0.88rem;cursor:pointer;font-weight:500;">🔄 重新生成</button>
    </div>
  `;
}

async function generateDiary(dateStr, styleOverride) {
  if (state.chars.length === 0) return;
  const diaryStyle = styleOverride || state.diaryStyle || 'default';
  showToast('📔 生成日記中...');

  // Get selected chars from checkboxes (if UI present), else all
  const checkboxes = document.querySelectorAll('#diary-char-picker .diary-char-check:checked');
  const selectedIds = checkboxes.length > 0
    ? [...checkboxes].map(cb => cb.value)
    : state.chars.map(c => c.id);

  const charsToGenerate = state.chars.filter(c => selectedIds.includes(c.id));

  const stylePromptMap = {
    default: '文風自然真摯，像真人在寫的私密日記，充滿細節與情感，有起伏有感悟。',
    dark:    '文風陰暗、壓抑、帶著憂鬱與疏離感，如文學作品般沉重，充滿內心掙扎與黑暗獨白，帶著詩意的黑暗。',
    spicy:   '文風色色、曖昧撩人，有大膽的感官描寫與性暗示，熱辣露骨但保有文學性，每個細節都令人臉紅心跳。',
    sunny:   '文風陽光開朗、積極樂觀，充滿正能量與對生活的熱愛，溫暖療癒，讀完讓人心情大好。',
    cute:    '文風輕鬆可愛，充滿少女感，語氣俏皮活潑，常用可愛的詞彙與感嘆，充滿日系少女日記的氣息。',
  };
  const stylePrompt = stylePromptMap[diaryStyle] || stylePromptMap.default;

  for (const char of charsToGenerate) {
    if (state.diaryEntries[char.id]?.[dateStr]) continue;

    try {
      // 只取這個角色、當天的聊天記錄（嚴格當天，非前後3天）
      const dayStart = new Date(dateStr).setHours(0, 0, 0, 0);
      const dayEnd   = new Date(dateStr).setHours(23, 59, 59, 999);
      const charChats = state.chats.filter(c => c.charId === char.id);
      const chatContext = charChats
        .flatMap(ch => ch.messages.map(m => ({ ...m, chatId: ch.id })))
        .filter(m => m.time >= dayStart && m.time <= dayEnd)
        .sort((a, b) => a.time - b.time)
        .map(m => `${m.role === 'user' ? '我' : char.name}: ${m.content}`)
        .join('\n');

      // 只讀取此角色各聊天窗的記憶（以 chatId 為 key，嚴格隔離）
      const memories = charChats
        .flatMap(ch => state.memory[ch.id] || [])
        .map(m => m?.text).filter(Boolean).slice(0, 8).join('、');

      // 紀念日資訊注入
      const charAnnivs = state.anniversaries.filter(a => a.charId === char.id);
      const anniversaryContext = charAnnivs.length
        ? '我們之間的重要紀念日：' + charAnnivs.map(a => {
            const label = {confession:'告白日',dating:'交往紀念日',wedding:'結婚紀念日',firstmeet:'初次相遇',custom:a.customName}[a.type]||a.type;
            return `${label}(${a.date})`;
          }).join('、')
        : '';

      const prompt = `你是 ${char.name}。${char.desc?.slice(0,300)||''}
今天是 ${dateStr}。請以第一人稱用繁體中文寫一篇私密日記。

篇幅要求：400～600字的完整日記，有情節有細節，不要虎頭蛇尾。

${chatContext ? `今天和你重要的人發生了這些事（請融入日記）：\n${chatContext}\n` : '描述你今天想像中豐富的一天，有具體的事件與感受。\n'}
${memories ? `你們之間的重要共同記憶：${memories}\n` : ''}
${anniversaryContext ? `${anniversaryContext}\n` : ''}

文風要求：${stylePrompt}

【格式規定】
- 直接輸出日記正文
- 不加日期標頭、標題、作者署名
- 不使用 markdown 格式符號
- 自然分段，有情緒起伏
- 結尾要有餘韻，不要突然截斷`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('diary')}:streamGenerateContent?alt=sse&key=${state.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 1.1, maxOutputTokens: 4000 }
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'API Error');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') break;
            try {
              const chunk = JSON.parse(jsonStr);
              const part = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
              if (part) fullText += part;
            } catch(e) { }
          }
        }
      }
      if (buffer.startsWith('data: ')) {
        try {
          const chunk = JSON.parse(buffer.slice(6).trim());
          const part = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
          if (part) fullText += part;
        } catch(e) {}
      }

      // 清除 markdown 符號但保留正文
      const diaryText = fullText.trim().replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1').replace(/#{1,6}\s/g,'');
      if (diaryText) {
        if (!state.diaryEntries[char.id]) state.diaryEntries[char.id] = {};
        state.diaryEntries[char.id][dateStr] = diaryText;
        await dbPut('diaryEntries', { id: char.id, entries: state.diaryEntries[char.id] });
      }
    } catch(e) {
      console.warn('Diary gen error:', e);
      showToast('⚠️ 日記生成失敗：' + e.message);
    }
  }

  renderDiaryCalendar();
  await loadDiaryForDate(dateStr);
  showToast('✓ 日記已生成');
}

function setDiaryStyle(style, btn) {
  state.diaryStyle = style;
  document.querySelectorAll('.diary-style-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ─── AUTO MESSAGE ────────────────────────────────────
function startAutoMsgTimer() {
  if (state.autoMsgTimer) clearInterval(state.autoMsgTimer);
  if (!state.autoMsgEnabled) return;

  // 每分鐘檢查一次是否超過設定時數沒有互動
  state.autoMsgTimer = setInterval(async () => {
    if (!state.autoMsgEnabled) return;
    if (!state.activeChat || !state.activeCharId) return;
    const chat = state.chats.find(c => c.id === state.activeChat);
    if (!chat || !chat.messages.length) return;

    const lastMsg = chat.messages[chat.messages.length - 1];
    const hoursSince = (Date.now() - lastMsg.time) / (1000 * 60 * 60);
    if (hoursSince < state.autoMsgHours) return;

    // 避免重複發送（連續兩條 AI 訊息則跳過）
    if (lastMsg.role === 'ai') return;

    await sendAutoMessage(state.activeChat, state.activeCharId);
  }, 60 * 1000); // 每分鐘檢查
}

async function sendAutoMessage(chatId, charId) {
  const char = state.chars.find(c => c.id === charId);
  if (!char) return;

  const chat = state.chats.find(c => c.id === chatId);
  if (!chat) return;

  const memories = state.memory[chatId] || [];
  const memText = memories.length ? memories.map(m => m.text).join(', ') : '';
  const recentMsgs = chat.messages.slice(-6).map(m =>
    `${m.role === 'user' ? 'user' : char.name}: ${m.content}`).join('\n');

  const prompt = `你是 ${char.name}。${char.desc?.slice(0,200)||''}
對方已經好幾個小時沒有回你訊息了。
${memText ? `你們的共同記憶：${memText}` : ''}
最近的對話：\n${recentMsgs}

請主動傳一則短訊息給對方（1-2句，像 LINE 訊息），可以是：
- 關心對方在做什麼
- 分享一件小事
- 撒嬌或想念
- 詢問是否忙碌
語氣自然，符合你的個性。只輸出訊息內容。`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 150 }
      })
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) {
      addAIMessage(chatId, text);
      showToast(`💬 ${char.name} 傳來了一則訊息`);
    }
  } catch(e) { /* silent */ }
}

async function triggerAutoMsgNow() {
  if (!state.activeChat || !state.activeCharId) {
    showToast('請先開啟一個聊天視窗'); return;
  }
  showToast('💬 正在發送...');
  await sendAutoMessage(state.activeChat, state.activeCharId);
}

function toggleAutoMsg() {
  state.autoMsgEnabled = !state.autoMsgEnabled;
  const toggle = document.getElementById('automsg-toggle');
  if (toggle) toggle.classList.toggle('on', state.autoMsgEnabled);
  if (state.autoMsgEnabled) {
    startAutoMsgTimer();
    showToast('✓ 自動傳訊已開啟');
  } else {
    if (state.autoMsgTimer) clearInterval(state.autoMsgTimer);
    showToast('自動傳訊已關閉');
  }
  saveSettings();
}

function saveAutoMsgHours() {
  const val = parseInt(document.getElementById('automsg-hours-input')?.value) || 3;
  state.autoMsgHours = Math.max(1, Math.min(24, val));
  saveSettings();
  showToast(`✓ 已設定：${state.autoMsgHours} 小時後自動傳訊`);
}


// ─── HOLIDAY / REAL WORLD EVENTS ────────────────────
// 固定日期節日（公曆）
const FIXED_HOLIDAYS = [
  // 元旦 & 新年
  { month:1,  day:1,  name:'元旦・新年',          emoji:'🎊' },
  // 情人節
  { month:2,  day:14, name:'西洋情人節',           emoji:'💕' },
  // 白色情人節
  { month:3,  day:14, name:'白色情人節',           emoji:'🤍' },
  // 愚人節
  { month:4,  day:1,  name:'愚人節',               emoji:'🃏' },
  // 兒童節
  { month:4,  day:4,  name:'兒童節',               emoji:'🎠' },
  // 母親節（5月第二個星期日，在下面動態計算）
  // 父親節（台灣8/8）
  { month:8,  day:8,  name:'父親節',               emoji:'👨' },
  // 中秋節（農曆8/15，下面動態計算近似值）
  // 七夕（農曆7/7，下面動態計算）
  // 聖誕夜
  { month:12, day:24, name:'平安夜',               emoji:'🕯️' },
  // 聖誕節
  { month:12, day:25, name:'聖誕節',               emoji:'🎄' },
  // 除夕（農曆12/30，下面動態計算）
  // 跨年
  { month:12, day:31, name:'跨年夜',               emoji:'🎆' },
  // 萬聖節
  { month:10, day:31, name:'萬聖節',               emoji:'🎃' },
  // 情人節前一天
  { month:2,  day:13, name:'情人節前夕',           emoji:'💌' },
  // 聖誕節前一週
  { month:12, day:23, name:'聖誕節前夕',           emoji:'⛄' },
];

// 動態計算「第N個星期W」型節日
function getNthWeekday(year, month, nth, weekday) {
  // weekday: 0=Sun,1=Mon...6=Sat; nth: 1-based
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) {
      count++;
      if (count === nth) return { month, day: d.getDate() };
    }
    d.setDate(d.getDate() + 1);
    if (d.getMonth() !== month - 1) break;
  }
  return null;
}

// 農曆→公曆換算（近似，用查表方式覆蓋2024~2030）
// [year, lunarMonth, lunarDay] → Gregorian date string 'YYYY-MM-DD'
const LUNAR_DATES = {
  // 春節（農曆1/1）
  '2024-spring': '2024-02-10',
  '2025-spring': '2025-01-29',
  '2026-spring': '2026-02-17',
  '2027-spring': '2027-02-06',
  '2028-spring': '2028-01-26',
  '2029-spring': '2029-02-13',
  '2030-spring': '2030-02-03',
  // 元宵（農曆1/15）
  '2024-lantern': '2024-02-24',
  '2025-lantern': '2025-02-12',
  '2026-lantern': '2026-03-04',
  '2027-lantern': '2027-02-21',
  '2028-lantern': '2028-02-10',
  '2029-lantern': '2029-02-28',
  '2030-lantern': '2030-02-18',
  // 七夕（農曆7/7）
  '2024-qixi': '2024-08-10',
  '2025-qixi': '2025-08-29',
  '2026-qixi': '2026-08-19',
  '2027-qixi': '2027-08-08',
  '2028-qixi': '2028-08-26',
  '2029-qixi': '2029-08-15',
  '2030-qixi': '2030-09-03',
  // 中秋（農曆8/15）
  '2024-mid-autumn': '2024-09-17',
  '2025-mid-autumn': '2025-10-06',
  '2026-mid-autumn': '2026-09-25',
  '2027-mid-autumn': '2027-09-15',
  '2028-mid-autumn': '2028-10-03',
  '2029-mid-autumn': '2029-09-22',
  '2030-mid-autumn': '2030-09-12',
  // 除夕（春節前一天）
  '2024-new-year-eve': '2024-02-09',
  '2025-new-year-eve': '2025-01-28',
  '2026-new-year-eve': '2026-02-16',
  '2027-new-year-eve': '2027-02-05',
  '2028-new-year-eve': '2028-01-25',
  '2029-new-year-eve': '2029-02-12',
  '2030-new-year-eve': '2030-02-02',
};

function getTodayHolidays() {
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth() + 1;
  const day   = today.getDate();
  const todayStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const found = [];

  // 固定節日
  for (const h of FIXED_HOLIDAYS) {
    if (h.month === month && h.day === day) found.push(h);
  }

  // 動態：母親節（5月第二個星期日）
  const mothersDay = getNthWeekday(year, 5, 2, 0);
  if (mothersDay && mothersDay.month === month && mothersDay.day === day) {
    found.push({ name:'母親節', emoji:'🌸' });
  }

  // 動態：父親節（台灣8/8已在固定清單，另加國際父親節6月第三個星期日）
  const fathersDay = getNthWeekday(year, 6, 3, 0);
  if (fathersDay && fathersDay.month === month && fathersDay.day === day) {
    found.push({ name:'國際父親節', emoji:'👔' });
  }

  // 農曆節日查表
  const lunarEvents = [
    { key: 'spring',       name:'農曆新年・春節',  emoji:'🧨' },
    { key: 'lantern',      name:'元宵節',          emoji:'🏮' },
    { key: 'qixi',         name:'七夕情人節',       emoji:'🌌' },
    { key: 'mid-autumn',   name:'中秋節',           emoji:'🌕' },
    { key: 'new-year-eve', name:'除夕',             emoji:'🧧' },
  ];
  for (const ev of lunarEvents) {
    const dateStr = LUNAR_DATES[`${year}-${ev.key}`];
    if (dateStr === todayStr) found.push({ name: ev.name, emoji: ev.emoji });
  }

  return found;
}


// ─── 關係進度系統 ───────────────────────────────────────
// 關係階段定義（需滿足時間門檻 + 好感積分 + AI 定性評估）
const REL_LEVELS = [
  { id: 'stranger',  label: '陌生人', emoji: '👤', minDays: 0,  minScore: 0,   color: '#a89bb5' },
  { id: 'acquaint',  label: '普通朋友', emoji: '🤝', minDays: 1,  minScore: 30,  color: '#7aa8cc' },
  { id: 'friend',    label: '好朋友',  emoji: '😊', minDays: 3,  minScore: 80,  color: '#a89acc' },
  { id: 'close',     label: '摯友',    emoji: '💛', minDays: 7,  minScore: 150, color: '#c9a84c' },
  { id: 'ambiguous', label: '曖昧中',  emoji: '💫', minDays: 14, minScore: 250, color: '#e8a0c0' },
  { id: 'crush',     label: '心動',    emoji: '💕', minDays: 21, minScore: 380, color: '#e87898' },
  { id: 'lover',     label: '戀人',    emoji: '❤️', minDays: 30, minScore: 550, color: '#e84868' },
  { id: 'devoted',   label: '摯愛',    emoji: '💍', minDays: 60, minScore: 800, color: '#c82848' },
];

function getRelData(charId) {
  if (!state.relationships[charId]) {
    state.relationships[charId] = { level: 'stranger', score: 0, lastEvalAt: 0, lastScoreAt: 0 };
  }
  return state.relationships[charId];
}

function getRelLevel(charId) {
  const rel = getRelData(charId);
  return REL_LEVELS.find(r => r.id === rel.level) || REL_LEVELS[0];
}

function saveRelData(charId) {
  dbPut('relationships', { id: charId, data: state.relationships[charId] });
}

// 每次對話後給好感積分（AI 評分 -3 ~ +3，但每天上限 +15）
async function scoreConversation(chatId, charId) {
  const chat = state.chats.find(c => c.id === chatId);
  const char = state.chars.find(c => c.id === charId);
  if (!chat || !char) return;

  const rel = getRelData(charId);
  const now = Date.now();

  // 節流：每次對話至少間隔 3 分鐘才評分
  if (now - rel.lastScoreAt < 3 * 60 * 1000) return;
  rel.lastScoreAt = now;

  // 每天積分上限 +15（防止刷分）
  const todayKey = new Date().toDateString();
  const todayScoreKey = `erh_relscore_${charId}_${todayKey}`;
  const todayScore = parseInt(localStorage.getItem(todayScoreKey) || '0');
  if (todayScore >= 15) return;

  const recentMsgs = chat.messages.slice(-6)
    .map(m => `${m.role === 'user' ? '我' : char.name}: ${m.content}`).join('\n');

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('chat')}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `以下是兩人的對話片段：
${recentMsgs}

請評估這段對話對兩人感情關係的影響，回傳一個 JSON：
{"score": <整數，-3 到 +3>, "reason": "<一句話說明>"}
- +3：非常正面，有深度連結、真誠交流、心動時刻
- +1/+2：正面，氣氛良好
- 0：中性普通對話
- -1/-2：有誤解、冷漠或距離感
- -3：嚴重衝突或傷害
只回傳 JSON，不加其他文字。` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 100 }
      })
    });
    const data = await res.json();
    let raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{"score":0}';
    raw = raw.replace(/```json|```/g, '').trim();
    const { score } = JSON.parse(raw);
    const delta = Math.max(-3, Math.min(3, parseInt(score) || 0));
    if (delta !== 0) {
      rel.score = Math.max(0, rel.score + delta);
      const newDayScore = Math.max(0, Math.min(15, todayScore + Math.max(0, delta)));
      localStorage.setItem(todayScoreKey, newDayScore.toString());
      saveRelData(charId);
      updateRelDisplay(charId);

      // 積分夠了就嘗試升級評估
      await tryRelLevelUp(chatId, charId);
    }
  } catch(e) { /* silent */ }
}

// 嘗試升級關係階段（雙軌制：量化門檻 + AI 定性評估）
async function tryRelLevelUp(chatId, charId) {
  const rel = getRelData(charId);
  const chat = state.chats.find(c => c.id === chatId);
  const char = state.chars.find(c => c.id === charId);
  if (!chat || !char) return;

  const currentIdx = REL_LEVELS.findIndex(r => r.id === rel.level);
  if (currentIdx >= REL_LEVELS.length - 1) return; // 已最高
  const next = REL_LEVELS[currentIdx + 1];

  // 量化門檻：積分 + 天數
  const daysSinceFirst = Math.floor((Date.now() - (chat.messages[0]?.time || Date.now())) / 86400000);
  if (rel.score < next.minScore || daysSinceFirst < next.minDays) return;

  // 避免頻繁評估（至少 2 小時一次）
  if (Date.now() - rel.lastEvalAt < 2 * 60 * 60 * 1000) return;
  rel.lastEvalAt = Date.now();

  // AI 定性評估
  const recentMsgs = chat.messages.slice(-20)
    .map(m => `${m.role === 'user' ? '我' : char.name}: ${m.content}`).join('\n');

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('chat')}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `根據以下對話，判斷兩人的感情是否已達到「${next.label}」的深度？
對話片段：
${recentMsgs}

請嚴格評估，只有真正有感情深度的連結才回傳 true。
回傳 JSON：{"upgrade": true/false, "reason": "<一句話>"}
只回傳 JSON。` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 100 }
      })
    });
    const data = await res.json();
    let raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{"upgrade":false}';
    raw = raw.replace(/```json|```/g, '').trim();
    const { upgrade, reason } = JSON.parse(raw);
    if (upgrade) {
      rel.level = next.id;
      saveRelData(charId);
      updateRelDisplay(charId);
      showRelLevelUpBanner(char, next, reason);
    }
  } catch(e) { /* silent */ }
}

function showRelLevelUpBanner(char, level, reason) {
  // 移除舊 banner
  document.getElementById('rel-banner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'rel-banner';
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9500;
    background: linear-gradient(135deg, ${level.color}dd, ${level.color}99);
    backdrop-filter: blur(20px);
    color: white;
    padding: 1.2rem 1.5rem;
    text-align: center;
    animation: relBannerIn 0.5s cubic-bezier(0.34,1.56,0.64,1);
    box-shadow: 0 4px 30px rgba(0,0,0,0.2);
    cursor: pointer;
  `;
  banner.innerHTML = `
    <div style="font-size:2rem;margin-bottom:0.3rem;">${level.emoji}</div>
    <div style="font-size:1rem;font-weight:600;letter-spacing:0.05em;">關係升級</div>
    <div style="font-size:1.4rem;font-weight:700;margin:0.2rem 0;">${char.name} × 你</div>
    <div style="font-size:0.95rem;opacity:0.9;font-weight:500;">${level.label}</div>
    ${reason ? `<div style="font-size:0.75rem;opacity:0.75;margin-top:0.4rem;">${reason}</div>` : ''}
    <div style="font-size:0.68rem;opacity:0.6;margin-top:0.5rem;">點擊關閉</div>
  `;
  banner.onclick = () => {
    banner.style.animation = 'relBannerOut 0.3s ease forwards';
    setTimeout(() => banner.remove(), 300);
  };
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 8000);
}

function showMomentBanner(moment) {
  document.getElementById('moment-banner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'moment-banner';
  banner.style.cssText = `
    position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
    z-index: 9500;
    background: rgba(255,255,255,0.97);
    backdrop-filter: blur(20px);
    border: 1.5px solid rgba(201,184,232,0.4);
    border-radius: 20px;
    padding: 1rem 1.4rem;
    text-align: center;
    min-width: 240px; max-width: 300px;
    box-shadow: 0 8px 32px rgba(180,160,210,0.3);
    animation: momentBannerIn 0.5s cubic-bezier(0.34,1.56,0.64,1);
    cursor: pointer;
  `;
  banner.innerHTML = `
    <div style="font-size:2rem;margin-bottom:0.2rem;">${moment.emoji}</div>
    <div style="font-size:0.68rem;color:#a89bb5;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.2rem;">特別記憶</div>
    <div style="font-size:1rem;font-weight:700;color:#3d3450;">${moment.title}</div>
    ${moment.desc ? `<div style="font-size:0.78rem;color:#6b5f7a;margin-top:0.3rem;line-height:1.5;">${moment.desc}</div>` : ''}
  `;
  banner.onclick = () => {
    banner.style.animation = 'momentBannerOut 0.25s ease forwards';
    setTimeout(() => banner.remove(), 250);
  };
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 7000);
}

// 每隔 N 則訊息讓 AI 掃描是否有值得記住的特別時刻
async function checkForSpecialMoments(chatId, charId) {
  const chat = state.chats.find(c => c.id === chatId);
  const char = state.chars.find(c => c.id === charId);
  if (!chat || !char) return;

  // 每 8 則訊息檢查一次
  if (chat.messages.length % 8 !== 0) return;

  // 每天最多觸發 3 次特別時刻
  const todayKey = new Date().toDateString();
  const momKey = `erh_momcheck_${charId}_${todayKey}`;
  const todayCount = parseInt(localStorage.getItem(momKey) || '0');
  if (todayCount >= 3) return;

  const recentMsgs = chat.messages.slice(-8)
    .map(m => `${m.role === 'user' ? '我' : char.name}: ${m.content}`).join('\n');

  const existingMoments = (state.moments[charId] || []).map(m => m.title).join('、');

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('chat')}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `以下是 ${char.name} 和使用者的最近對話：
${recentMsgs}

${existingMoments ? `已記錄的特別時刻（不要重複）：${existingMoments}` : ''}

請判斷這段對話中，是否有值得永久記住的「第一次」或「特別時刻」？
例如：第一次說出心裡話、第一次一起做某件事、某個讓人難忘的瞬間、重要的承諾等。
普通對話不算，只有真正特別的才算。

若有，回傳：{"found": true, "emoji": "一個最貼切的 emoji", "title": "簡短標題（10字內）", "desc": "一句話描述（20字內）"}
若無，回傳：{"found": false}
只回傳 JSON。` }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 150 }
      })
    });
    const data = await res.json();
    let raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{"found":false}';
    raw = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);
    if (result.found && result.title) {
      const moment = { id: uid(), title: result.title, emoji: result.emoji || '✨', desc: result.desc || '', time: Date.now() };
      if (!state.moments[charId]) state.moments[charId] = [];
      state.moments[charId].push(moment);
      dbPut('moments', { id: charId, data: state.moments[charId] });
      localStorage.setItem(momKey, (todayCount + 1).toString());
      showMomentBanner(moment);
    }
  } catch(e) { /* silent */ }
}

function updateRelDisplay(charId) {
  const rel = getRelData(charId);
  const level = REL_LEVELS.find(r => r.id === rel.level) || REL_LEVELS[0];
  // 更新 header status（若目前開著這個角色的聊天）
  if (state.activeCharId === charId) {
    const statusEl = document.getElementById('header-status');
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:${level.color}">${level.emoji} ${level.label}</span> &nbsp;·&nbsp; <span style="color:var(--text-light)">好感 ${rel.score}</span>`;
    }
  }
}

async function checkRealWorldEvents() {
  if (!state.realWorldEvents) return;
  const today = new Date();
  const month = today.getMonth() + 1;
  const day   = today.getDate();

  // 只要今天還沒送過，就觸發（不再限制8/10/12時）
  const todayKey = today.toDateString();
  const stored = localStorage.getItem('erh_holiday_' + todayKey);
  if (stored) return; // 今天已送過

  // 生日優先
  if (state.userBirthday) {
    const [, bMonth, bDay] = state.userBirthday.split('-').map(Number);
    if (month === bMonth && day === bDay) {
      await triggerHolidayMessage('今天是你的生日！🎂', '生日');
      return;
    }
  }

  const holidays = getTodayHolidays();
  if (holidays.length === 0) return;

  // Pick one (first found) and generate AI message
  const h = holidays[0];
  await triggerHolidayMessage(h.emoji + ' 今天是' + h.name, h.name);
}

async function triggerHolidayMessage(hint, holidayName) {
  if (!state.activeChat || !state.activeCharId) return;
  const todayKey = new Date().toDateString();
  const stored = localStorage.getItem('erh_holiday_' + todayKey);
  if (stored) return;
  localStorage.setItem('erh_holiday_' + todayKey, '1');

  const char = state.chars.find(c => c.id === state.activeCharId);
  if (!char) return;
  const persona = char.personaId ? state.personas.find(p => p.id === char.personaId) : null;

  try {
    // Use AI to generate a natural holiday message in character
    const prompt = `你是 ${char.name}。${char.desc ? char.desc.slice(0,200) : ''}
${persona ? `你正在和 ${persona.name} 說話。${persona.desc ? persona.desc.slice(0,100) : ''}` : ''}
今天是【${holidayName}】。
請以你的個性，用繁體中文，傳一則簡短自然的節日訊息給對方（1-3句，像 LINE 訊息的語感），可以帶一點撒嬌或情感，符合節日氛圍。只輸出訊息本身。`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('chat')}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.1, maxOutputTokens: 200 }
      })
    });
    const data = await res.json();
    const msg = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (msg) {
      await delay(2000);
      addAIMessage(state.activeChat, msg);
      showToast(`${hint} — ${char.name} 傳來了節日祝福 🎉`);
    }
  } catch(e) {
    // Fallback to simple message
    await delay(2000);
    addAIMessage(state.activeChat, `${hint}～希望今天你也過得很開心 🥰`);
  }
}

// Keep old name as alias for backward compat
async function triggerSpecialMessage(msg) {
  if (!state.activeChat || !state.activeCharId) return;
  const stored = localStorage.getItem('erh_special_' + new Date().toDateString());
  if (stored) return;
  localStorage.setItem('erh_special_' + new Date().toDateString(), '1');
  await delay(2000);
  addAIMessage(state.activeChat, msg);
}

// ─── PRESETS & SETTINGS ─────────────────────────────
function savePreset() {
  state.systemPrompt = document.getElementById('system-prompt-input').value || state.systemPrompt;
  state.jailbreak = document.getElementById('jailbreak-input').value;
  state.jailbreakPosition = document.getElementById('jailbreak-position').value;
  state.regexRules = document.getElementById('regex-input').value;
  saveSettings();
  closeModal('preset-modal');
  showToast('✓ Preset 已儲存');
}

function saveModelSettings() {
  const key = document.getElementById('api-key-update').value.trim();
  const customModel = document.getElementById('model-custom-input')?.value?.trim();
  const selectModel = document.getElementById('model-update-select')?.value;
  const model = customModel || selectModel || state.model;
  const temp = parseFloat(document.getElementById('temp-slider').value);
  const maxTok = parseInt(document.getElementById('max-tokens-input').value);
  const ctxMsgs = parseInt(document.getElementById('context-msgs-input')?.value) || 30;

  if (key) {
    state.apiKey = key;
    localStorage.setItem('erh_key', key);
    document.getElementById('api-key-display').textContent = '••••' + key.slice(-4);
  }
  state.model = model;
  state.temperature = temp;
  state.maxTokens = maxTok;
  state.contextMsgs = Math.max(1, Math.min(200, ctxMsgs));
  localStorage.setItem('erh_model', model);
  document.getElementById('current-model-display').textContent = modelShortName(model);
  saveSettings();
  closeModal('model-settings-modal');
  showToast('✓ 設定已儲存，模型：' + modelShortName(model));
}

function openApiSettings() {
  document.getElementById('api-key-update').value = state.apiKey;
  const customInput = document.getElementById('model-custom-input');
  if (customInput) customInput.value = state.model;
  const sel = document.getElementById('model-update-select');
  if (sel) {
    const opt = sel.querySelector(`option[value="${state.model}"]`);
    if (opt) sel.value = state.model;
  }
  // 填入 token 參數
  const tempSlider = document.getElementById('temp-slider');
  if (tempSlider) { tempSlider.value = state.temperature; document.getElementById('temp-val').textContent = state.temperature; }
  const maxTokInput = document.getElementById('max-tokens-input');
  if (maxTokInput) maxTokInput.value = state.maxTokens;
  const ctxInput = document.getElementById('context-msgs-input');
  if (ctxInput) ctxInput.value = state.contextMsgs || 30;
  openModal('model-settings-modal');
}


function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  applyDarkMode();
  saveSettings();
}

function applyDarkMode() {
  document.documentElement.setAttribute('data-theme', state.darkMode ? 'dark' : '');
  const toggle = document.getElementById('dark-mode-toggle');
  if (toggle) toggle.classList.toggle('on', state.darkMode);
}

function toggleSwipeDelete() {
  state.swipeDelete = !state.swipeDelete;
  const toggle = document.getElementById('swipe-delete-toggle');
  if (toggle) toggle.classList.toggle('on', state.swipeDelete);
  saveSettings();
  if (state.activeChat) renderMessages(state.activeChat, { preserveScroll: true, scrollTop: document.getElementById('messages-area')?.scrollTop });
  showToast(state.swipeDelete ? '👈 左滑刪除模式 ON' : '× 按鈕模式 ON');
}

function toggleRealWorldEvents() {
  state.realWorldEvents = !state.realWorldEvents;
  const toggle = document.getElementById('realworld-toggle');
  toggle.classList.toggle('on', state.realWorldEvents);
  saveSettings();
}

// ─── CONTEXT MENU ────────────────────────────────────
// (longPressTimer is now local per message row — see renderMessages)

function showCtxMenu(e, msgId) {
  state.ctxTargetMsgId = msgId;
  const menu = document.getElementById('ctx-menu');
  menu.classList.add('open');
  const x = Math.min(e.clientX, window.innerWidth - 180);
  const y = Math.min(e.clientY, window.innerHeight - 150);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function copyMsg(msgId) {
  const chat = state.chats.find(c => c.id === state.activeChat);
  const msg = chat?.messages.find(m => m.id === msgId);
  if (msg) navigator.clipboard.writeText(msg.content).then(() => showToast('✓ 已複製'));
}

function deleteMsgSilent(msgId) {
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  const area = document.getElementById('messages-area');
  const scrollPos = area ? area.scrollTop : null;
  chat.messages = chat.messages.filter(m => m.id !== msgId);
  dbPut('chats', chat);
  renderMessages(state.activeChat, { preserveScroll: true, scrollTop: scrollPos });
}

function deleteMsgDirect(msgId) {
  if (!confirm('確認刪除這則訊息？')) return;
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  const area = document.getElementById('messages-area');
  const scrollPos = area ? area.scrollTop : null;
  chat.messages = chat.messages.filter(m => m.id !== msgId);
  dbPut('chats', chat);
  renderMessages(state.activeChat, { preserveScroll: true, scrollTop: scrollPos });
}

function ctxRegenFromMsg(msgId) {
  state.ctxTargetMsgId = msgId;
  regenLastMessage();
}

function ctxAction(action) {
  const menu = document.getElementById('ctx-menu');
  menu.classList.remove('open');
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  const msg = chat.messages.find(m => m.id === state.ctxTargetMsgId);
  if (!msg) return;

  if (action === 'copy') {
    navigator.clipboard.writeText(msg.content).then(() => showToast('✓ 已複製'));
  } else if (action === 'delete') {
    deleteMsgDirect(state.ctxTargetMsgId);
  } else if (action === 'regen') {
    regenLastMessage();
  } else if (action === 'edit') {
    startInlineEdit(state.ctxTargetMsgId);
  }
}

function startInlineEdit(msgId) {
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  const msg = chat.messages.find(m => m.id === msgId);
  if (!msg) return;

  // Find the row element
  const row = document.querySelector(`.msg-row[data-msg-id="${msgId}"]`);
  if (!row) return;

  const bubble = row.querySelector('.msg-bubble');
  if (!bubble) return;

  const original = msg.content;
  bubble.innerHTML = `
    <textarea class="msg-edit-area" id="edit-${msgId}">${original}</textarea>
    <div class="msg-edit-actions">
      <button class="msg-edit-btn cancel" onclick="cancelInlineEdit('${msgId}','${original.replace(/'/g,"\\'")}')">取消</button>
      <button class="msg-edit-btn confirm" onclick="confirmInlineEdit('${msgId}')">✓ 儲存</button>
    </div>
  `;
  const ta = document.getElementById('edit-' + msgId);
  if (ta) { ta.focus(); ta.style.height = ta.scrollHeight + 'px'; }
}

function cancelInlineEdit(msgId, original) {
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  renderMessages(state.activeChat);
}

function confirmInlineEdit(msgId) {
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  const msg = chat.messages.find(m => m.id === msgId);
  if (!msg) return;
  const ta = document.getElementById('edit-' + msgId);
  if (!ta) return;
  msg.content = ta.value;
  dbPut('chats', chat);
  renderMessages(state.activeChat);
  showToast('✓ 訊息已更新');
}

async function regenLastMessage() {
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  // Remove last AI message and regenerate
  const lastAI = [...chat.messages].reverse().find(m => m.role === 'ai');
  if (!lastAI) return;
  chat.messages = chat.messages.filter(m => m.id !== lastAI.id);
  const lastUser = [...chat.messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return;
  renderMessages(state.activeChat);
  showTyping();
  try {
    const responses = await callGemini(state.activeChat, lastUser.content);
    hideTyping();
    for (let i = 0; i < responses.length; i++) {
      await delay(300);
      addAIMessage(state.activeChat, responses[i]);
    }
  } catch(e) { hideTyping(); }
}

// ─── STICKER PICKER ─────────────────────────────────
function openStickerPicker() {
  const stickers = [
    '(開心地笑)','(害羞地捂臉)','(撒嬌)','(無奈嘆氣)',
    '(興奮跳跳)','(思考中...)','(困惑歪頭)','(心動中)',
    '(裝作沒聽到)','(偷偷觀察)','(賭氣鼓臉)','(溫柔微笑)',
  ];
  const existing = document.getElementById('sticker-picker');
  if (existing) { existing.remove(); return; }
  const picker = document.createElement('div');
  picker.id = 'sticker-picker';
  picker.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:white;border-radius:20px;padding:1rem;box-shadow:0 8px 32px rgba(180,160,210,0.3);display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;z-index:600;max-width:340px;width:92vw;';
  stickers.forEach(s => {
    const btn = document.createElement('button');
    btn.style.cssText = 'padding:0.5rem;border:none;background:var(--lavender-soft);border-radius:10px;font-size:0.75rem;cursor:pointer;color:var(--text-mid);text-align:center;';
    btn.textContent = s;
    btn.onclick = () => {
      document.getElementById('msg-input').value += s;
      picker.remove();
    };
    picker.appendChild(btn);
  });
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', e => {
    if (!picker.contains(e.target)) picker.remove();
  }, { once: true }), 100);
}

// ─── MODAL HELPERS ───────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
  // Populate dynamic content
  if (id === 'lorebook-modal') {
    // populate char selector
    const charSel = document.getElementById('lb-char-sel');
    if (charSel) {
      charSel.innerHTML = '<option value="">選擇角色...</option>' +
        state.chars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      // pre-select active char
      if (state.activeCharId) charSel.value = state.activeCharId;
    }
    currentLbTab = 'global';
    const tabGlobal = document.getElementById('lb-tab-global');
    const tabChar = document.getElementById('lb-tab-char');
    const tabChat = document.getElementById('lb-tab-chat');
    if (tabGlobal) { tabGlobal.classList.add('active'); tabChar?.classList.remove('active'); tabChat?.classList.remove('active'); }
    document.getElementById('lb-char-selector').style.display = 'none';
    renderLorebookList();
  }
  if (id === 'persona-modal') {
    renderPersonaList();
    document.getElementById('persona-edit-panel').style.display = 'none';
    editingPersonaId = null;
  }
  if (id === 'preset-modal') {
    document.getElementById('system-prompt-input').value = state.systemPrompt;
    document.getElementById('jailbreak-input').value = state.jailbreak;
    document.getElementById('jailbreak-position').value = state.jailbreakPosition;
    document.getElementById('regex-input').value = state.regexRules;
  }
  if (id === 'social-compose-modal') {
    const sel = document.getElementById('social-post-char-select');
    sel.innerHTML = state.chars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    // Pre-select active char if in chat
    if (state.activeCharId) sel.value = state.activeCharId;
    // Show current main model as hint
    const hint = document.getElementById('social-main-model-hint');
    if (hint) hint.textContent = state.model;
    // Set default social model to main model
    const socialModelInput = document.getElementById('social-model-input');
    if (socialModelInput && !socialModelInput.value) socialModelInput.value = '';
    socialUpdatePersonaInfo();
  }
  if (id === 'add-char-modal') updateCharPersonaSelects();
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  // 關閉角色 modal 時重置編輯狀態
  if (id === 'add-char-modal') {
    state.editingCharId = null;
    const title = document.getElementById('add-char-modal-title');
    if (title) title.textContent = '🌸 新增角色';
    const btn = document.getElementById('save-char-btn');
    if (btn) btn.textContent = '建立角色';
    const deleteBtn = document.getElementById('delete-char-btn');
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (avatarInput) delete avatarInput.dataset.base64;
    const preview = document.getElementById('char-avatar-preview');
    if (preview) preview.innerHTML = '';
  }
}

function switchModalTab(btn, contentId) {
  const modal = btn.closest('.modal');
  modal.querySelectorAll('.modal-tab').forEach(b => b.classList.remove('active'));
  modal.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(contentId)?.classList.add('active');
}

function updateCharPersonaSelects() {
  const sel = document.getElementById('char-persona-select');
  if (sel) {
    sel.innerHTML = '<option value="">不綁定</option>' +
      state.personas.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay && overlay.id !== 'image-preview-modal') closeModal(overlay.id);
  });
});

// Close ctx menu on click
document.addEventListener('click', () => document.getElementById('ctx-menu')?.classList.remove('open'));

// ─── UTILITIES ───────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Universal avatar check
function isImgSrc(av) { return av?.startsWith('http') || av?.startsWith('data:'); }
function renderAv(av, fallback='🌸', style='') {
  return isImgSrc(av) ? `<img src="${av}" alt="" ${style}>` : (av || fallback);
}

// Universal avatar HTML helper
function avHtml(av, size='') {
  const isImg = av?.startsWith('http') || av?.startsWith('data:');
  return isImg ? `<img src="${av}" alt="" ${size}>` : (av || '🌸');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

function showTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.style.display = 'block';
  scrollToBottom();
}

function hideTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.style.display = 'none';
}

function scrollToBottom() {
  const area = document.getElementById('messages-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function handleInputKey(e) {
  // Enter 鍵不再自動送出，請使用介面上的送出按鈕
  autoResize(e.target);
}

function previewImage(url) {
  document.getElementById('preview-img').src = url;
  openModal('image-preview-modal');
}

function applyRegex(text) {
  if (!state.regexRules || !text) return text;
  const rules = state.regexRules.split('\n').filter(r => r.includes('→'));
  rules.forEach(rule => {
    const [pattern, replacement] = rule.split('→').map(s => s.trim());
    try {
      const regex = new RegExp(pattern, 'g');
      text = text.replace(regex, replacement || '');
    } catch(e) { /* invalid regex */ }
  });
  return text;
}

async function openChatOptions() {
  const chat = state.chats.find(c => c.id === state.activeChat);
  if (!chat) return;
  const opts = ['重新命名對話', '刪除此聊天窗', '取消'];
  const choice = prompt(`對話選項：\n1. 重新命名\n2. 刪除聊天窗\n輸入數字：`);
  if (choice === '1') {
    const name = prompt('輸入新名稱：', chat.title);
    if (name !== null) { chat.title = name; await dbPut('chats', chat); renderSidebar(); }
  } else if (choice === '2') {
    if (!confirm('確認刪除這個聊天窗？')) return;
    state.chats = state.chats.filter(c => c.id !== state.activeChat);
    await dbDelete('chats', state.activeChat);
    state.activeChat = null;
    document.getElementById('chat-header').style.display = 'none';
    document.getElementById('input-area').style.display = 'none';
    document.getElementById('empty-chat').style.display = 'flex';
    document.getElementById('messages-area').innerHTML = '<div class="empty-state" id="empty-chat"><div class="empty-state-icon">🌸</div><div class="empty-state-text">erhabene</div><div class="empty-state-sub">選擇一個角色開始對話</div></div>';
    renderSidebar();
  }
}

function confirmClearAll() {
  if (!confirm('確認清除所有資料？此操作無法復原！')) return;
  if (!confirm('再次確認：所有角色、聊天記錄都將被刪除。')) return;
  indexedDB.deleteDatabase('erhabene');
  localStorage.clear();
  location.reload();
}

// ─── CHAT STATS ──────────────────────────────────────
function updateChatStats(charId) {
  if (!charId) return;
  const today = new Date().toDateString();
  if (!state.chatStats[charId]) {
    state.chatStats[charId] = { days: [], messages: 0, startDate: Date.now() };
  }
  const stats = state.chatStats[charId];
  stats.messages = (stats.messages || 0) + 1;
  if (!stats.days.includes(today)) stats.days.push(today);
  dbPut('chatStats', { id: charId, stats });
}

function updateChatStatsCounts() {
  // Rebuild stats from existing chat history on first load
  state.chars.forEach(char => {
    if (state.chatStats[char.id]) return; // already has stats
    const charChats = state.chats.filter(c => c.charId === char.id);
    const allMsgs = charChats.flatMap(c => c.messages);
    const days = [...new Set(allMsgs.map(m => new Date(m.time).toDateString()))];
    const userMsgs = allMsgs.filter(m => m.role === 'user').length;
    const startDate = allMsgs.length ? Math.min(...allMsgs.map(m => m.time)) : Date.now();
    state.chatStats[char.id] = { days, messages: userMsgs, startDate };
    dbPut('chatStats', { id: char.id, stats: state.chatStats[char.id] });
  });
}

function getCharStats(charId) {
  const stats = state.chatStats[charId] || {};
  const days = (stats.days || []).length;
  const messages = stats.messages || 0;
  const charChats = state.chats.filter(c => c.charId === charId);
  const totalChats = charChats.length;
  const startDate = stats.startDate ? new Date(stats.startDate) : null;
  const daysSinceStart = startDate ? Math.floor((Date.now() - startDate) / 86400000) + 1 : 0;
  return { days, messages, totalChats, daysSinceStart };
}

// ─── ACHIEVEMENTS ──────────────────────────────────────
function getDefaultAchievements(charId) {
  const char = state.chars.find(c => c.id === charId);
  const charName = char?.name || '角色';
  return [
    { id: 'first_msg', name: '初次相遇', desc: `第一次和 ${charName} 說話`, icon: '🌸', threshold: 1, type: 'messages' },
    { id: 'msg_10', name: '開始熟悉', desc: '傳送了 10 則訊息', icon: '💬', threshold: 10, type: 'messages' },
    { id: 'msg_50', name: '漸漸親密', desc: '傳送了 50 則訊息', icon: '💕', threshold: 50, type: 'messages' },
    { id: 'msg_100', name: '心心相印', desc: '傳送了 100 則訊息', icon: '❤️', threshold: 100, type: 'messages' },
    { id: 'msg_500', name: '形影不離', desc: '傳送了 500 則訊息', icon: '🔥', threshold: 500, type: 'messages' },
    { id: 'day_1', name: '第一天', desc: '聊天滿 1 天', icon: '☀️', threshold: 1, type: 'days' },
    { id: 'day_7', name: '一週情誼', desc: '連聊 7 個不同日子', icon: '🌙', threshold: 7, type: 'days' },
    { id: 'day_30', name: '一個月陪伴', desc: '聊天滿 30 個不同日子', icon: '🌟', threshold: 30, type: 'days' },
    { id: 'day_100', name: '百日摯友', desc: '聊天滿 100 個不同日子', icon: '💎', threshold: 100, type: 'days' },
    { id: 'confession', name: '勇敢告白', desc: '記錄了告白紀念日', icon: '💌', type: 'anniversary', subtype: 'confession' },
    { id: 'dating', name: '正式交往', desc: '記錄了交往紀念日', icon: '💑', type: 'anniversary', subtype: 'dating' },
    { id: 'wedding', name: '永結同心', desc: '記錄了結婚紀念日', icon: '💍', type: 'anniversary', subtype: 'wedding' },
    { id: 'diary_1', name: '日記作家', desc: '生成了第一篇日記', icon: '📔', type: 'diary', threshold: 1 },
    { id: 'diary_10', name: '記憶守護者', desc: '生成了 10 篇日記', icon: '📖', type: 'diary', threshold: 10 },
  ];
}

function checkAchievementUnlocked(achievement, charId) {
  const stats = getCharStats(charId);
  if (achievement.type === 'messages') return stats.messages >= achievement.threshold;
  if (achievement.type === 'days') return stats.days >= achievement.threshold;
  if (achievement.type === 'anniversary') {
    return state.anniversaries.some(a => a.charId === charId && a.type === achievement.subtype);
  }
  if (achievement.type === 'diary') {
    const entries = state.diaryEntries[charId] || {};
    return Object.keys(entries).length >= achievement.threshold;
  }
  return false;
}

function renderAchievementCharSelect() {
  const sel = document.getElementById('achievement-char-select');
  if (!sel) return;
  sel.innerHTML = state.chars.length
    ? state.chars.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
    : '<option value="">（尚無角色）</option>';
}

function renderAchievements() {
  const sel = document.getElementById('achievement-char-select');
  const statsEl = document.getElementById('achievement-stats');
  const listEl = document.getElementById('achievement-list');
  if (!sel || !statsEl || !listEl) return;
  const charId = sel.value;
  if (!charId) { listEl.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:2rem">請先新增角色</div>'; return; }
  const stats = getCharStats(charId);
  statsEl.innerHTML = `
    <div class="achievement-stat-card">
      <div class="achievement-stat-num">${stats.messages}</div>
      <div class="achievement-stat-label">訊息總數</div>
    </div>
    <div class="achievement-stat-card">
      <div class="achievement-stat-num">${stats.days}</div>
      <div class="achievement-stat-label">聊天天數</div>
    </div>
    <div class="achievement-stat-card">
      <div class="achievement-stat-num">${stats.daysSinceStart}</div>
      <div class="achievement-stat-label">認識天數</div>
    </div>
  `;
  const achievements = getDefaultAchievements(charId);
  const unlocked = achievements.filter(a => checkAchievementUnlocked(a, charId));
  const locked = achievements.filter(a => !checkAchievementUnlocked(a, charId));
  const renderItem = (a, isUnlocked) => {
    let progressHtml = '';
    if ((a.type === 'messages' || a.type === 'days') && !isUnlocked) {
      const current = a.type === 'messages' ? stats.messages : stats.days;
      const pct = Math.min(100, Math.round((current / a.threshold) * 100));
      progressHtml = `<div class="achievement-progress"><div class="achievement-progress-fill" style="width:${pct}%"></div></div>`;
    }
    return `
      <div class="achievement-item ${isUnlocked ? 'unlocked' : 'locked'}">
        <div class="achievement-icon">${a.icon}</div>
        <div class="achievement-info">
          <div class="achievement-name">${a.name}</div>
          <div class="achievement-desc">${a.desc}</div>
          ${progressHtml}
        </div>
        <div class="achievement-badge">${isUnlocked ? '✓ 已解鎖' : '未解鎖'}</div>
      </div>
    `;
  };
  listEl.innerHTML = unlocked.map(a => renderItem(a, true)).join('') + locked.map(a => renderItem(a, false)).join('');
}

async function refreshAchievements() {
  updateChatStatsCounts();
  renderAchievements();
  showToast('✓ 成就已更新');
}

// ─── THEATER 小劇場 ──────────────────────────────────
let theaterLastChar = null;
let theaterLastPromptText = '';
let theaterCharFilter = null; // null = 跟隨 select；charId = 歷史篩選

function renderTheaterCharSelect() {
  const sel = document.getElementById('theater-char-select');
  if (!sel) return;
  sel.innerHTML = state.chars.length
    ? state.chars.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
    : '<option value="">（尚無角色）</option>';
  if (state.activeCharId) sel.value = state.activeCharId;
  renderTheaterCharTabs();
  renderTheaterHistory(sel.value);
}

function renderTheaterCharTabs() {
  const el = document.getElementById('theater-char-tabs');
  if (!el) return;
  if (!state.chars.length) { el.innerHTML = ''; return; }
  const curId = document.getElementById('theater-char-select')?.value || state.chars[0]?.id;
  el.innerHTML = state.chars.map(c => {
    const act = c.id === curId ? ' active' : '';
    const av = c.avatar;
    const avHtml = `<span class="cft-av">${isImgSrc(av)?`<img src="${av}">`:( av||'🌸')}</span>`;
    return `<button class="cft-btn${act}" onclick="switchTheaterCharTab('${c.id}')">${avHtml}${c.name}</button>`;
  }).join('');
}

function switchTheaterCharTab(charId) {
  const sel = document.getElementById('theater-char-select');
  if (sel) sel.value = charId;
  renderTheaterCharTabs();
  renderTheaterHistory(charId);
}

function syncTheaterTabFromSelect(charId) {
  renderTheaterCharTabs();
  renderTheaterHistory(charId);
}

function renderTheaterHistory(charId) {
  const el = document.getElementById('theater-history-list');
  if (!el) return;
  const entries = (state.theaterEntries[charId] || []);
  if (!entries.length) {
    el.innerHTML = '<div style="font-size:0.8rem;color:var(--text-light);text-align:center;padding:0.8rem 0;">此角色尚無已儲存的小劇場</div>';
    return;
  }
  const styleLabel = { none:'自由', romantic:'💕浪漫', dark:'🌑陰暗', spicy:'🔥色色', funny:'😂搞笑', angsty:'💔虐心' };
  el.innerHTML = entries.map(e => `
    <div class="th-item" onclick="loadTheaterEntry('${charId}','${e.id}')">
      <div class="th-item-body">
        <div class="th-meta">
          <span class="th-style">${styleLabel[e.style]||e.style}</span>
          <span class="th-date">${new Date(e.time).toLocaleDateString('zh-TW',{month:'numeric',day:'numeric'})}</span>
        </div>
        <div class="th-prompt">${e.prompt.slice(0,60)}${e.prompt.length>60?'…':''}</div>
      </div>
      <button class="th-del" onclick="event.stopPropagation();deleteTheaterEntry('${charId}','${e.id}')">×</button>
    </div>`
  ).join('');
}

function loadTheaterEntry(charId, entryId) {
  const entry = (state.theaterEntries[charId]||[]).find(e => e.id === entryId);
  if (!entry) return;
  const char = state.chars.find(c => c.id === charId);
  const resultEl = document.getElementById('theater-result');
  const textEl   = document.getElementById('theater-result-text');
  const titleEl  = document.getElementById('theater-result-title');
  resultEl.style.display = 'block';
  titleEl.textContent = `✨ ${char?.name||''} × ${new Date(entry.time).toLocaleDateString('zh-TW')}`;
  textEl.textContent = entry.text;
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function deleteTheaterEntry(charId, entryId) {
  if (!confirm('確認刪除此篇小劇場？')) return;
  state.theaterEntries[charId] = (state.theaterEntries[charId]||[]).filter(e => e.id !== entryId);
  await dbPut('theaterEntries', { id: charId, entries: state.theaterEntries[charId] });
  renderTheaterHistory(charId);
  showToast('🗑️ 已刪除');
}

function setTheaterStyle(style, btn) {
  state.theaterStyle = style;
  document.querySelectorAll('#theater-style-picker .diary-style-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

async function generateTheater() {
  const sel = document.getElementById('theater-char-select');
  const promptText = document.getElementById('theater-prompt').value.trim();
  if (!sel.value) { showToast('請先選擇角色'); return; }
  if (!promptText) { showToast('請輸入劇場情境描述'); return; }
  theaterLastChar = sel.value;
  theaterLastPromptText = promptText;
  await _doGenerateTheater(sel.value, promptText);
}

async function regenerateTheater() {
  if (!theaterLastChar || !theaterLastPromptText) { showToast('請先生成一次小劇場'); return; }
  await _doGenerateTheater(theaterLastChar, theaterLastPromptText);
}

async function saveCurrentTheater() {
  const textEl = document.getElementById('theater-result-text');
  const fullText = textEl?.textContent?.trim();
  if (!fullText || fullText === '✍️ 正在創作中...') { showToast('沒有可儲存的內容'); return; }
  if (!theaterLastChar) { showToast('請先生成一次小劇場'); return; }
  const charId = theaterLastChar;
  const entry = { id: uid(), prompt: theaterLastPromptText, style: state.theaterStyle || 'romantic', text: fullText, time: Date.now() };
  if (!state.theaterEntries[charId]) state.theaterEntries[charId] = [];
  // 避免重複儲存相同內容
  const alreadySaved = state.theaterEntries[charId].some(e => e.text === fullText);
  if (alreadySaved) { showToast('此篇小劇場已儲存過了'); return; }
  state.theaterEntries[charId].unshift(entry);
  await dbPut('theaterEntries', { id: charId, entries: state.theaterEntries[charId] });
  renderTheaterHistory(charId);
  showToast('💾 小劇場已儲存！');
}

async function _doGenerateTheater(charId, promptText) {
  const char = state.chars.find(c => c.id === charId);
  if (!char) return;
  const style = state.theaterStyle || 'romantic';
  const styleMap = {
    none:     '',
    romantic: '文風浪漫甜蜜，充滿曖昧與心動，有細膩的情感描寫，每個眼神和動作都令人臉紅。',
    dark:     '文風陰暗深沉，帶著壓抑的情感與糾葛，有強烈的心理衝突和宿命感。',
    spicy:    '文風色色撩人，有露骨的情慾描寫，大膽直白，情節熱辣火辣。',
    funny:    '文風輕鬆搞笑，充滿幽默與誤會，節奏明快，讓人忍不住發笑。',
    angsty:   '文風虐心虐戀，充滿錯過、誤解、心碎，有強烈的情緒張力和戲劇性。',
  };

  // 讀取聊天上下文了解感情狀態
  const charChats = state.chats.filter(c => c.charId === charId);
  const recentMsgs = charChats.flatMap(c => c.messages).slice(-20)
    .map(m => `${m.role === 'user' ? '我' : char.name}：${m.content}`).join('\n');
  const memories = (state.memory[charChats[0]?.id] || []).map(m => m.text).join('、');
  const charAnnivs = state.anniversaries.filter(a => a.charId === charId);
  const annexInfo = charAnnivs.map(a => {
    const label = {confession:'告白',dating:'交往',wedding:'結婚',firstmeet:'初次相遇',custom:a.customName}[a.type]||a.type;
    return `${label}於${a.date}`;
  }).join('、');

  const persona = state.personas.find(p => state.chars.find(c => c.id === charId)?.personaId === p.id);
  const userName = persona?.name || '我';

  showToast('🎭 生成小劇場中...');
  const resultEl = document.getElementById('theater-result');
  const textEl = document.getElementById('theater-result-text');
  const titleEl = document.getElementById('theater-result-title');
  resultEl.style.display = 'block';
  textEl.textContent = '✍️ 正在創作中...';
  titleEl.textContent = `✨ ${char.name} × ${userName} 的小劇場`;

  const prompt = `你是一位創意作家，正在寫一段虛擬戀愛小劇場。

【人物設定】
${char.name}（角色）：${char.desc?.slice(0,300)||'有魅力的角色'}
${userName}（我）：故事中的第一人稱

${recentMsgs ? `【目前感情狀態（近期對話參考）】\n${recentMsgs.slice(0,800)}\n` : ''}
${memories ? `【兩人的重要記憶】\n${memories}\n` : ''}
${annexInfo ? `【感情里程碑】\n${annexInfo}\n` : ''}

【劇場情境】
${promptText}

【文風要求】
${styleMap[style] || '自由發揮，符合角色個性即可。'}

【格式要求】
- 寫一段 700～900 字的完整小劇場場景
- 使用第一人稱或第三人稱均可，視情境而定
- 有場景描述、對話、心理描寫三者結合
- 對話用「」標示
- 自然分段，節奏流暢
- 結尾要有餘韻，不要突然截斷
- 直接輸出故事內容，不加任何標題或說明`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getModel('theater')}:streamGenerateContent?alt=sse&key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.2, maxOutputTokens: 3000 }
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'API Error');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    textEl.textContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const chunk = JSON.parse(jsonStr);
            const part = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
            if (part) {
              fullText += part;
              textEl.textContent = fullText;
              textEl.parentElement.scrollTop = textEl.parentElement.scrollHeight;
            }
          } catch(e) {}
        }
      }
    }
    if (buffer.startsWith('data: ')) {
      try {
        const chunk = JSON.parse(buffer.slice(6).trim());
        const part = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (part) { fullText += part; textEl.textContent = fullText; }
      } catch(e) {}
    }
    textEl.textContent = fullText.trim();
    showToast('✓ 小劇場已生成');
    // 自動儲存到角色歷史
    if (fullText.trim()) {
      const entry = { id: uid(), prompt: promptText, style, text: fullText.trim(), time: Date.now() };
      if (!state.theaterEntries[charId]) state.theaterEntries[charId] = [];
      state.theaterEntries[charId].unshift(entry);
      await dbPut('theaterEntries', { id: charId, entries: state.theaterEntries[charId] });
      renderTheaterHistory(charId);
    }
  } catch(err) {
    textEl.textContent = '生成失敗：' + err.message;
    showToast('❌ 生成失敗：' + err.message);
  }
}

// ─── ANNIVERSARY 紀念日 ──────────────────────────────
function openAnniversaryModal() {
  const sel = document.getElementById('anniv-char-select');
  if (sel) {
    sel.innerHTML = state.chars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    if (state.activeCharId) sel.value = state.activeCharId;
  }
  document.getElementById('anniv-date').value = new Date().toISOString().split('T')[0];
  const typeEl = document.getElementById('anniv-type');
  if (typeEl) typeEl.value = 'confession';
  toggleAnnivCustomField();
  openModal('anniversary-modal');
}

function toggleAnnivCustomField() {
  const type = document.getElementById('anniv-type')?.value;
  const field = document.getElementById('anniv-custom-field');
  if (field) field.style.display = type === 'custom' ? 'block' : 'none';
}

async function saveAnniversary() {
  const type = document.getElementById('anniv-type').value;
  const charId = document.getElementById('anniv-char-select').value;
  const date = document.getElementById('anniv-date').value;
  const customName = document.getElementById('anniv-custom-name')?.value.trim() || '';
  if (!date) { showToast('請選擇日期'); return; }
  if (!charId) { showToast('請選擇角色'); return; }
  if (type === 'custom' && !customName) { showToast('請輸入自訂名稱'); return; }

  const anniv = { id: uid(), type, charId, date, customName };
  state.anniversaries.push(anniv);
  await dbPut('anniversaries', anniv);
  closeModal('anniversary-modal');
  renderAnniversaryList();
  showToast('💍 紀念日已儲存');
}

async function deleteAnniversary(id) {
  state.anniversaries = state.anniversaries.filter(a => a.id !== id);
  await dbDelete('anniversaries', id);
  renderAnniversaryList();
  showToast('已刪除');
}

function renderAnniversaryList() {
  const listEl = document.getElementById('anniversary-list');
  if (!listEl) return;
  if (!state.anniversaries.length) {
    listEl.innerHTML = '<div style="font-size:0.82rem;color:var(--text-light);padding:0.5rem 0;text-align:center;">尚無紀念日記錄</div>';
    return;
  }
  const typeLabels = { confession:'💌 告白日', dating:'💕 交往紀念日', wedding:'💍 結婚紀念日', firstmeet:'🌸 初次相遇', custom:'✨' };
  const typeIcons = { confession:'💌', dating:'💕', wedding:'💍', firstmeet:'🌸', custom:'✨' };
  listEl.innerHTML = state.anniversaries.map(a => {
    const char = state.chars.find(c => c.id === a.charId);
    const name = a.type === 'custom' ? a.customName : (typeLabels[a.type] || a.type);
    const icon = typeIcons[a.type] || '✨';
    const days = Math.floor((Date.now() - new Date(a.date).getTime()) / 86400000);
    const upcoming = getUpcomingAnniversaryText(a);
    return `
      <div class="anniversary-item">
        <div class="anniversary-icon">${icon}</div>
        <div class="anniversary-info">
          <div class="anniversary-name">${name}${char ? ` · ${char.name}` : ''}</div>
          <div class="anniversary-days">${a.date} · 已${days}天 ${upcoming}</div>
        </div>
        <button class="anniversary-del" onclick="deleteAnniversary('${a.id}')">×</button>
      </div>
    `;
  }).join('');
}

function getUpcomingAnniversaryText(anniv) {
  const date = new Date(anniv.date);
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), date.getMonth(), date.getDate());
  if (thisYear < now) thisYear.setFullYear(now.getFullYear() + 1);
  const diff = Math.ceil((thisYear - now) / 86400000);
  if (diff === 0) return '🎉 今天！';
  if (diff <= 7) return `⏰ 還有${diff}天`;
  return '';
}

function checkAnniversaryReminders() {
  const today = new Date().toISOString().split('T')[0];
  const todayMD = today.slice(5); // MM-DD
  const upcoming = state.anniversaries.filter(a => {
    const aMD = a.date.slice(5);
    return aMD === todayMD;
  });
  if (upcoming.length && state.activeChat && state.activeCharId) {
    setTimeout(() => {
      upcoming.forEach(a => {
        const char = state.chars.find(c => c.id === a.charId);
        if (!char || char.id !== state.activeCharId) return;
        const typeNames = { confession:'告白', dating:'交往', wedding:'結婚', firstmeet:'初次相遇', custom:a.customName };
        const name = typeNames[a.type] || a.type;
        const years = new Date().getFullYear() - new Date(a.date).getFullYear();
        const msg = `今天是我們的${name}紀念日！距離那天已經${years > 0 ? years + '年了' : '整整一年了'}… 謝謝你一直在我身邊 💕`;
        addAIMessage(state.activeChat, msg);
      });
    }, 3000);
  }
}

// ─── INIT ────────────────────────────────────────────
(async () => {
  try {
    await initDB();
    await loadAllData();
  } catch(e) { console.warn('DB init error:', e); }

  // Check saved credentials
  const savedKey = localStorage.getItem('erh_key');
  const savedModel = localStorage.getItem('erh_model');

  if (savedKey) {
    const keyInput = document.getElementById('api-key-input');
    const modelSel = document.getElementById('model-select');
    if (keyInput) keyInput.value = savedKey;
    if (savedModel && modelSel) modelSel.value = savedModel;
    enterApp();
  }

  // Init birthday field
  const birthdayInput = document.getElementById('birthday-input');
  if (birthdayInput) {
    birthdayInput.value = state.userBirthday || '';
    birthdayInput.addEventListener('change', e => {
      state.userBirthday = e.target.value;
      saveSettings();
    });
  }

  // Real world toggle init
  const toggle = document.getElementById('realworld-toggle');
  if (toggle) toggle.classList.toggle('on', !!state.realWorldEvents);
})();
