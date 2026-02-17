// ═══════════════════════════════════════════════════════
//  erhabene — app.js
//  Pure frontend, IndexedDB for persistence
// ═══════════════════════════════════════════════════════

// ─── STATE ───────────────────────────────────────────
let DB = null;
let state = {
  apiKey: '',
  model: 'gemini-2.0-flash',
  temperature: 1.0,
  maxTokens: 2048,
  chars: [],        // [{id, name, avatar, desc, firstMsg, personaId}]
  chats: [],        // [{id, charId, title, messages:[]}]
  personas: [],     // [{id, name, desc}]
  lorebook: [],     // [{id, keywords:[], content, enabled}]
  systemPrompt: `You are {{char}}, a living, breathing person talking with {{user}} via LINE messenger.
Reply in Traditional Chinese. Keep replies SHORT and natural — like real LINE messages (1-3 sentences max per bubble, send multiple separate messages). 
Do NOT use asterisks for actions. Instead use (括號文字描述) for expressions/stickers.
Stay in character at all times. Be warm, personal, and emotionally real.`,
  jailbreak: '',
  jailbreakPosition: 'before_last',
  regexRules: '',
  socialPosts: [],  // [{id, charId, platform, content, imageUrl, comments:[], time}]
  diaryEntries: {}, // {charId: {date: content}}
  memory: {},       // {chatId: [{category, text}]}
  activeChat: null, // chatId
  activeCharId: null,
  currentPage: 'chat',
  diaryMonth: new Date(),
  selectedDiaryDate: null,
  cctvCharId: null,
  spellMode: false,
  spellContext: [],
  realWorldEvents: true,
  userBirthday: '',
  ctxTargetMsgId: null,
  autoMsgEnabled: true,    // 角色自動傳訊息開關
  autoMsgHours: 3,         // 幾小時無回覆後自動發
  autoMsgTimer: null,      // setInterval handle
  editingCharId: null,     // 正在編輯的角色 id
};

// ─── INDEXEDDB ─────────────────────────────────────
function initDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('erhabene', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      ['chars','chats','personas','lorebook','socialPosts','diaryEntries','memory','settings'].forEach(store => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = e => { DB = e.target.result; res(DB); };
    req.onerror = () => rej(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const tx = DB.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function dbPut(store, obj) {
  return new Promise((res, rej) => {
    const tx = DB.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function dbDelete(store, id) {
  return new Promise((res, rej) => {
    const tx = DB.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

async function loadAllData() {
  const [chars, chats, personas, lorebook, socialPosts, settings] = await Promise.all([
    dbGetAll('chars'), dbGetAll('chats'), dbGetAll('personas'),
    dbGetAll('lorebook'), dbGetAll('socialPosts'), dbGetAll('settings')
  ]);
  state.chars = chars;
  state.chats = chats;
  state.personas = personas;
  state.lorebook = lorebook;
  state.socialPosts = socialPosts;

  // load memories
  const memTx = DB.transaction('memory','readonly');
  const memAll = await new Promise(res => {
    const req = memTx.objectStore('memory').getAll();
    req.onsuccess = () => res(req.result);
  });
  memAll.forEach(m => { state.memory[m.id] = m.items; });

  // load diary
  const dTx = DB.transaction('diaryEntries','readonly');
  const dAll = await new Promise(res => {
    const req = dTx.objectStore('diaryEntries').getAll();
    req.onsuccess = () => res(req.result);
  });
  dAll.forEach(d => { state.diaryEntries[d.id] = d.entries; });

  // load settings
  const s = settings[0] || {};
  if (s.systemPrompt) state.systemPrompt = s.systemPrompt;
  if (s.jailbreak) state.jailbreak = s.jailbreak;
  if (s.jailbreakPosition) state.jailbreakPosition = s.jailbreakPosition;
  if (s.regexRules) state.regexRules = s.regexRules;
  if (s.realWorldEvents !== undefined) state.realWorldEvents = s.realWorldEvents;
  if (s.userBirthday) state.userBirthday = s.userBirthday;
  if (s.autoMsgEnabled !== undefined) state.autoMsgEnabled = s.autoMsgEnabled;
  if (s.autoMsgHours) state.autoMsgHours = s.autoMsgHours;
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
    autoMsgEnabled: state.autoMsgEnabled,
    autoMsgHours: state.autoMsgHours,
  });
}

// ─── SETUP / ENTER APP ────────────────────────────
function enterApp() {
  const key = document.getElementById('api-key-input').value.trim();
  // 優先讀取自訂輸入，否則讀下拉
  const customModel = document.getElementById('model-custom-input-setup')?.value?.trim();
  const selectModel = document.getElementById('model-select')?.value;
  const model = customModel || selectModel || 'gemini-3.0-flash';
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
  updateSpellCharSelect();
  initDiary();
  renderSocialFeed();
  checkRealWorldEvents();
  startAutoMsgTimer();
}

function modelShortName(m) {
  if (!m) return '未設定';
  if (m.includes('3.0-ultra')) return 'Gemini 3.0 Ultra';
  if (m.includes('3.0-pro')) return 'Gemini 3.0 Pro';
  if (m.includes('3.0-flash')) return 'Gemini 3.0 Flash';
  if (m.includes('3.0')) return 'Gemini 3.0';
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

  // 切換任何頁面都先收合底部 spell-panel
  document.getElementById('spell-panel')?.classList.remove('open');

  // 咒語舞台：完全佔滿畫面，隱藏 sidebar
  if (page === 'cctv') {
    sidebar.style.display = 'none';
    renderSpellStage();
    return;
  }

  // 其他頁面恢復 sidebar
  sidebar.style.display = '';
  sidebar.classList.remove('mobile-open');

  if (page === 'chat') {
    sidebarTitle.textContent = '聊天';
    sidebarAddBtn.textContent = '＋ 新增對話';
    sidebarAddBtn.onclick = showAddChatOrChar;
    renderSidebar();
  } else if (page === 'chars') {
    sidebar.classList.add('mobile-open');
    renderSidebar('chars');
    sidebarTitle.textContent = '角色';
    sidebarAddBtn.textContent = '＋ 新增角色';
    sidebarAddBtn.onclick = () => openModal('add-char-modal');
    renderCharsGrid();
  } else if (page === 'social') {
    renderSocialFeed();
  } else if (page === 'diary') {
    initDiary();
  }
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
      const avatarHtml = char.avatar?.startsWith('http')
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
              ${c.avatar?.startsWith('http') ? `<img src="${c.avatar}" style="width:100%;height:100%;object-fit:cover">` : (c.avatar || '🌸')}
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
  avatarDiv.innerHTML = char.avatar?.startsWith('http')
    ? `<img src="${char.avatar}" alt="">` : (char.avatar || '🌸');
  document.getElementById('header-name').textContent = char.name;
  document.getElementById('header-status').textContent = '在線';

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
}

// ─── MESSAGES ───────────────────────────────────────
function renderMessages(chatId) {
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
        const avContent = av?.startsWith('http') ? `<img src="${av}" alt="">` : (av || '🌸');
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

      if (group.role === 'user') {
        row.innerHTML = `${timeEl}${bubbleContent}`;
      } else {
        row.innerHTML = `${avatarHtml}${bubbleContent}${timeEl}`;
      }

      row.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, msg.id); });
      row.addEventListener('touchstart', handleLongPress.bind(null, msg.id), { passive: true });
      row.addEventListener('touchend', clearLongPress);

      groupEl.appendChild(row);
    });

    area.appendChild(groupEl);
  });

  // Typing indicator placeholder
  area.innerHTML += `<div id="typing-indicator" style="display:none;"><div class="msg-group ai"><div class="msg-row"><div class="msg-avatar">${(() => { const c = state.chars.find(c=>c.id===state.activeCharId); const av = c?.avatar; return av?.startsWith('http') ? `<img src="${av}">` : (av||'🌸'); })()}</div><div class="msg-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div></div></div>`;

  scrollToBottom();
}

function addAIMessage(chatId, content, type = 'text', imageUrl = null) {
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat) return;
  const msg = { id: uid(), role: 'ai', content, type, imageUrl, time: Date.now() };
  chat.messages.push(msg);
  dbPut('chats', chat);
  renderMessages(chatId);
  return msg;
}

function addUserMessage(chatId, content) {
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat) return;
  const msg = { id: uid(), role: 'user', content, type: 'text', time: Date.now() };
  chat.messages.push(msg);
  dbPut('chats', chat);
  renderMessages(chatId);
  return msg;
}

async function sendMessage() {
  if (!state.activeChat) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';

  addUserMessage(state.activeChat, text);
  showTyping();

  try {
    const responses = await callGemini(state.activeChat, text);
    hideTyping();
    // Send multiple short messages with delays (LINE style)
    for (let i = 0; i < responses.length; i++) {
      await delay(400 + Math.random() * 600);
      addAIMessage(state.activeChat, responses[i]);
      if (i < responses.length - 1) showTyping();
    }
    // Auto-update memory
    await autoUpdateMemory(state.activeChat);
  } catch(err) {
    hideTyping();
    addAIMessage(state.activeChat, `（系統錯誤：${err.message}）`);
  }
}

// ─── GEMINI API ─────────────────────────────────────
async function callGemini(chatId, userMessage, overrideSystem = null) {
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
  const history = chat.messages.slice(-30).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  // Remove last user message (we'll add it separately)
  if (history.length && history[history.length-1].role === 'user') history.pop();

  // Jailbreak before last
  let contents = [...history];
  if (state.jailbreak && state.jailbreakPosition === 'before_last') {
    contents.push({ role: 'user', parts: [{ text: state.jailbreak + '\n\n' + userMessage }] });
  } else {
    contents.push({ role: 'user', parts: [{ text: userMessage }] });
  }

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      temperature: state.temperature,
      maxOutputTokens: state.maxTokens,
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${state.apiKey}`;
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
  // Split by newlines or sentence endings to simulate LINE bubbles
  const lines = text.split(/\n+/).filter(l => l.trim());
  if (lines.length <= 1) {
    // Split long text by sentences
    const sentences = text.match(/[^。！？…\n]+[。！？…\n]*/g) || [text];
    const chunks = [];
    let current = '';
    sentences.forEach(s => {
      if ((current + s).length > 60 && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current += s;
      }
    });
    if (current.trim()) chunks.push(current.trim());
    return chunks.filter(c => c).slice(0, 4);
  }
  return lines.slice(0, 4);
}

// ─── GEMINI IMAGE GEN ─────────────────────────────
// refImages: [{base64: 'data:image/png;base64,...', mimeType: 'image/png'}]
async function callGeminiImage(prompt, refImages = []) {
  const imageModel = 'gemini-3-pro-image-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${state.apiKey}`;

  // 組裝 parts：先放參考圖，再放文字 prompt
  const parts = [];
  for (const img of refImages) {
    if (!img?.base64) continue;
    // data:image/png;base64,XXXX → 取出 mimeType 和 data
    const match = img.base64.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) continue;
    parts.push({
      inlineData: { mimeType: match[1], data: match[2] }
    });
  }
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

async function triggerImageGen() {
  if (!state.activeChat) return;
  const chat = state.chats.find(c => c.id === state.activeChat);
  const char = state.chars.find(c => c.id === chat?.charId);
  if (!char) return;

  showToast('🖼️ 正在生成圖片...');
  try {
    const recentMsgs = chat.messages.slice(-5).map(m => m.content).join(' ');

    // 收集參考圖：角色頭貼 + persona 頭貼
    const refImages = [];
    const charRef = getAvatarRef(char.avatar);
    if (charRef) refImages.push(charRef);

    const persona = char.personaId ? state.personas.find(p => p.id === char.personaId) : null;
    if (persona?.avatar) {
      const personaRef = getAvatarRef(persona.avatar);
      if (personaRef) refImages.push(personaRef);
    }

    const hasRefs = refImages.length > 0;
    const prompt = hasRefs
      ? `Based on the reference image(s) provided (use them as style/character reference), create an anime-style illustration.
Character: ${char.name}. ${char.desc?.slice(0,100) || ''}.
Scene based on recent conversation: ${recentMsgs.slice(0,200)}.
Soft watercolor aesthetic, pastel colors. Keep character design consistent with reference.`
      : `Anime style illustration. Character: ${char.name}. ${char.desc?.slice(0,100) || ''}.
Scene based on recent conversation: ${recentMsgs.slice(0,200)}.
Soft watercolor aesthetic, pastel colors.`;

    const imageUrl = await callGeminiImage(prompt, refImages);
    addAIMessage(state.activeChat, '📸 生成了一張圖片', 'image', imageUrl);
    hideTyping();
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${state.apiKey}`;
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

function toggleMemoryPanel() {
  const panel = document.getElementById('memory-panel');
  panel.classList.toggle('open');
}

// ─── LOREBOOK ───────────────────────────────────────
// ST-compatible fields: {id, name, keys, secondary_keys, content, comment,
//   enabled, constant, selective, case_sensitive,
//   insertion_order, position, scan_depth, token_budget}
function getLorebookMatches(text) {
  return state.lorebook
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

function renderLorebookList() {
  const list = document.getElementById('lorebook-list');
  if (!state.lorebook.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-light);font-size:0.82rem;padding:1.5rem 1rem;">尚無條目 — 點擊下方「＋ 新增條目」</div>';
    return;
  }
  list.innerHTML = state.lorebook.map(e => {
    const keys = e.keys || e.keywords || [];
    const keyStr = keys.join(', ') || '（無關鍵字）';
    const isOpen = lorebookEditId === e.id;
    const safeContent = (e.content || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeName = (e.name || '').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    const safeKeys = keys.join(', ').replace(/"/g,'&quot;');
    const safeSecKeys = (e.secondary_keys || []).join(', ').replace(/"/g,'&quot;');
    const safeComment = (e.comment || '').replace(/"/g,'&quot;');
    return `<div class="lb-entry${isOpen?' lb-open':''}" id="lb-entry-${e.id}">
      <div class="lb-header" onclick="toggleLorebookEntry('${e.id}')">
        <div class="lb-entry-left">
          <input type="checkbox" class="lb-enable-cb" ${e.enabled?'checked':''}
            onclick="event.stopPropagation();lbToggleEnabled('${e.id}',this.checked)" title="啟用">
          ${e.constant?'<span class="lb-badge lb-const" title="Always On">∞</span>':''}
          ${e.selective?'<span class="lb-badge lb-sel" title="Selective">◈</span>':''}
          <span class="lb-name">${safeName||'（未命名）'}</span>
        </div>
        <div class="lb-entry-right">
          <span class="lb-keys-preview">${keyStr.slice(0,28)}${keyStr.length>28?'…':''}</span>
          <span class="lb-order" title="Insertion Order">#${e.insertion_order||100}</span>
          <button onclick="event.stopPropagation();deleteLorebook('${e.id}')" class="lb-del-btn">×</button>
        </div>
      </div>
      ${isOpen ? `<div class="lb-body">
        <div class="lb-row-2col">
          <div class="lb-field" style="flex:2">
            <label class="lb-label">名稱（Entry Name）</label>
            <input class="lb-input" id="lb-name-${e.id}" value="${safeName}" placeholder="e.g. World Building">
          </div>
          <div class="lb-field" style="flex:0 0 80px">
            <label class="lb-label">Order</label>
            <input class="lb-input" type="number" id="lb-order-${e.id}" value="${e.insertion_order||100}" min="0" max="999">
          </div>
        </div>
        <div class="lb-field">
          <label class="lb-label">Primary Keys（逗號分隔，匹配任一即觸發）</label>
          <input class="lb-input" id="lb-keys-${e.id}" value="${safeKeys}" placeholder="keyword1, keyword2, ...">
        </div>
        <div class="lb-field">
          <label class="lb-label">Secondary Keys（Selective 模式需同時匹配）</label>
          <input class="lb-input" id="lb-sec-${e.id}" value="${safeSecKeys}" placeholder="secondary1, secondary2">
        </div>
        <div class="lb-field">
          <label class="lb-label">Content（注入 context 的內容）</label>
          <textarea class="lb-textarea" id="lb-content-${e.id}">${safeContent}</textarea>
        </div>
        <div class="lb-field">
          <label class="lb-label">Comment（備註，不會注入）</label>
          <input class="lb-input" id="lb-comment-${e.id}" value="${safeComment}" placeholder="自用備註">
        </div>
        <div class="lb-row-flags">
          <div class="lb-field">
            <label class="lb-label">Position</label>
            <select class="lb-select" id="lb-pos-${e.id}">
              <option value="before_char" ${(e.position||'before_char')==='before_char'?'selected':''}>↑ Before Char Desc</option>
              <option value="after_char" ${e.position==='after_char'?'selected':''}>↓ After Char Desc</option>
              <option value="before_prompt" ${e.position==='before_prompt'?'selected':''}>↑ Before Prompt</option>
              <option value="at_depth" ${e.position==='at_depth'?'selected':''}>@ Depth (AN)</option>
            </select>
          </div>
          <div class="lb-field" style="flex:0 0 70px">
            <label class="lb-label">Scan Depth</label>
            <input class="lb-input" type="number" id="lb-depth-${e.id}" value="${e.scan_depth||4}" min="1" max="200">
          </div>
          <div class="lb-field" style="flex:0 0 80px">
            <label class="lb-label">Token Budget</label>
            <input class="lb-input" type="number" id="lb-budget-${e.id}" value="${e.token_budget||400}" min="0" max="8192">
          </div>
        </div>
        <div class="lb-row-flags" style="margin-top:0.5rem;gap:1rem;">
          <label class="lb-checkbox-label"><input type="checkbox" id="lb-const-${e.id}" ${e.constant?'checked':''}><span>Constant（永遠注入）</span></label>
          <label class="lb-checkbox-label"><input type="checkbox" id="lb-sel-${e.id}" ${e.selective?'checked':''}><span>Selective</span></label>
          <label class="lb-checkbox-label"><input type="checkbox" id="lb-case-${e.id}" ${e.case_sensitive?'checked':''}><span>Case Sensitive</span></label>
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:0.9rem;">
          <button class="lb-save-btn" onclick="lbSaveEntry('${e.id}')">✓ 儲存</button>
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
  const e = state.lorebook.find(l => l.id === id);
  if (e) { e.enabled = enabled; dbPut('lorebook', e); }
}

function lbSaveEntry(id) {
  const e = state.lorebook.find(l => l.id === id);
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
  dbPut('lorebook', e);
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
  state.lorebook.push(entry);
  dbPut('lorebook', entry);
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
  state.lorebook = state.lorebook.filter(l => l.id !== id);
  dbDelete('lorebook', id);
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
  list.innerHTML = state.personas.map(p => `
    <div style="background:var(--lavender-soft);border-radius:12px;padding:0.8rem;margin-bottom:0.5rem;border:1px solid rgba(201,184,232,0.2);">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:500;color:var(--text-dark)">${p.name}</div>
        <button onclick="deletePersona('${p.id}')" style="background:none;border:none;cursor:pointer;color:#e87878;font-size:0.85rem">刪除</button>
      </div>
      <div style="font-size:0.78rem;color:var(--text-light);margin-top:0.2rem">${(p.desc||'').slice(0,60)}</div>
    </div>
  `).join('') || '<div style="text-align:center;color:var(--text-light);font-size:0.82rem;padding:1rem;">還沒有設定 Persona</div>';
}

async function addPersona() {
  const name = prompt('Persona 名稱（你的角色名）：');
  if (!name) return;
  const desc = prompt('描述（選填）：') || '';
  const persona = { id: uid(), name, desc };
  state.personas.push(persona);
  await dbPut('personas', persona);
  renderPersonaList();
  updateCharPersonaSelects();
  document.getElementById('persona-display').textContent = name;
}

async function deletePersona(id) {
  state.personas = state.personas.filter(p => p.id !== id);
  await dbDelete('personas', id);
  renderPersonaList();
}

// ─── CHARACTERS ─────────────────────────────────────
function renderCharsGrid() {
  const grid = document.getElementById('chars-grid');
  grid.innerHTML = '';

  state.chars.forEach(char => {
    const card = document.createElement('div');
    card.className = 'char-card';
    const avContent = char.avatar?.startsWith('http')
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
      if (avatarDiv) avatarDiv.innerHTML = char.avatar?.startsWith('data:') || char.avatar?.startsWith('http')
        ? `<img src="${char.avatar}" alt="">` : (char.avatar || '🌸');
      document.getElementById('header-name').textContent = char.name;
    }
  } else {
    // ── 新增模式 ──
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
    const isImg = char.avatar?.startsWith('data:') || char.avatar?.startsWith('http');
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

// ─── SPELL (小劇場) ──────────────────────────────────
function toggleSpellPanel() {
  document.getElementById('spell-panel').classList.toggle('open');
}

async function castSpell() {
  const charSelect = document.getElementById('spell-char-select');
  const spellText = document.getElementById('spell-input').value.trim();
  const charId = charSelect.value;

  if (!charId || charId === '選擇角色...') { showToast('請選擇角色'); return; }
  if (!spellText) { showToast('請輸入小劇場內容'); return; }

  const char = state.chars.find(c => c.id === charId);
  if (!char) return;

  toggleSpellPanel();
  showToast('✨ 進入小劇場模式...');

  // Build spell context with current relationship info
  const memories = state.memory[state.activeChat] || [];
  const memText = memories.length ? memories.map(m => m.text).join(', ') : '（無記憶）';
  const recentMsgs = state.activeChat
    ? (state.chats.find(c => c.id === state.activeChat)?.messages || []).slice(-6)
        .map(m => `${m.role}: ${m.content}`).join('\n') : '';

  const spellSystem = `你正在進行一個小劇場（roleplay scenario）。
角色：${char.name}
${char.desc || ''}

[目前感情狀態與記憶]
${memText}

[最近的聊天內容]
${recentMsgs}

[小劇場設定]
${spellText}

重要：這是獨立的小劇場空間，不影響主聊天記錄。盡情投入，字數可以更長，可以有更多描述。`;

  // Create temporary spell conversation
  const spellChatId = 'spell_' + uid();
  const tempChat = { id: spellChatId, charId, messages: [] };
  state.chats.push(tempChat);

  // Open spell in main chat area with visual indicator
  state.activeChat = spellChatId;
  state.activeCharId = charId;
  document.getElementById('chat-header').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('header-name').textContent = `✨ ${char.name} — 小劇場`;
  document.getElementById('header-status').textContent = '小劇場模式（不計入記錄）';

  const area = document.getElementById('messages-area');
  area.innerHTML = `<div class="date-divider"><span>✨ 小劇場開始</span></div>`;

  showTyping();
  try {
    const responses = await callGemini(spellChatId, '開始場景', spellSystem);
    hideTyping();
    for (let i = 0; i < responses.length; i++) {
      await delay(300 + Math.random() * 400);
      addAIMessage(spellChatId, responses[i]);
      if (i < responses.length - 1) showTyping();
    }
  } catch(e) {
    hideTyping();
    addAIMessage(spellChatId, `（小劇場錯誤：${e.message}）`);
  }

  document.getElementById('spell-input').value = '';
}

function updateSpellCharSelect() {
  const sel = document.getElementById('spell-char-select');
  sel.innerHTML = '<option>選擇角色...</option>' +
    state.chars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

// ─── SOCIAL ─────────────────────────────────────────
let currentSocialTab = 'plurk';

function switchSocialTab(tab, btn) {
  currentSocialTab = tab;
  document.querySelectorAll('.social-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSocialFeed();
}

function renderSocialFeed() {
  const feed = document.getElementById('social-feed');
  const posts = state.socialPosts.filter(p => p.platform === currentSocialTab)
    .sort((a, b) => b.time - a.time);

  let html = '';

  // Compose area
  html += `
    <div class="post-compose">
      <textarea class="compose-input" id="compose-input" placeholder="${currentSocialTab === 'plurk' ? '說點什麼...' : '分享這一刻...'}"></textarea>
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
    html += `<div class="empty-state"><div class="empty-state-icon">${currentSocialTab === 'plurk' ? '🌊' : '📷'}</div><div class="empty-state-text">還沒有貼文<br>讓角色來發第一篇吧</div></div>`;
  } else {
    if (currentSocialTab === 'plurk') {
      html += '<div class="plurk-timeline">';
      posts.forEach(post => {
        const char = state.chars.find(c => c.id === post.charId);
        const av = char?.avatar;
        const avHtml = av?.startsWith('http') ? `<img src="${av}">` : (av || '🌊');
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
    } else {
      // IG style grid-ish
      posts.forEach(post => {
        const char = state.chars.find(c => c.id === post.charId);
        const av = char?.avatar;
        const avHtml = av?.startsWith('http') ? `<img src="${av}">` : (av || '📷');
        html += `
          <div class="post-card">
            <div class="post-header">
              <div class="post-avatar">${avHtml}</div>
              <div>
                <div class="post-author">${post.authorName || char?.name || 'User'}</div>
                <div class="post-time">${formatTime(post.time)}</div>
              </div>
            </div>
            ${post.imageUrl ? `<div class="post-image"><img src="${post.imageUrl}" onclick="previewImage('${post.imageUrl}')" loading="lazy"></div>` : ''}
            <div class="post-content" style="margin-top:0.6rem;">${post.content}</div>
            <div class="post-actions">
              <button class="post-action-btn" onclick="likePost('${post.id}')">🤍 ${post.likes || 0}</button>
              <button class="post-action-btn" onclick="replyToPost('${post.id}')">💬 ${(post.comments||[]).length}</button>
              <button class="post-action-btn" onclick="deletePost('${post.id}')">🗑️</button>
            </div>
            ${renderComments(post)}
            <div id="reply-area-${post.id}" style="display:none;margin-top:0.5rem;">
              <div style="display:flex;gap:0.4rem;">
                <input id="reply-input-${post.id}" placeholder="新增留言..." style="flex:1;padding:0.4rem 0.7rem;border:1px solid var(--lavender-light);border-radius:10px;font-family:inherit;font-size:0.82rem;outline:none;background:var(--lavender-soft);">
                <button onclick="submitReply('${post.id}')" style="padding:0.4rem 0.7rem;background:var(--lavender);border:none;border-radius:10px;color:white;font-family:inherit;font-size:0.78rem;cursor:pointer;">送出</button>
              </div>
            </div>
          </div>
        `;
      });
    }
  }

  feed.innerHTML = html;
}

function renderComments(post) {
  if (!post.comments?.length) return '';
  return `<div class="post-comments">${post.comments.map(c => {
    const char = state.chars.find(ch => ch.id === c.charId);
    const av = char?.avatar;
    const avHtml = av?.startsWith('http') ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover;">` : (av || '💬');
    return `
      <div class="comment-item">
        <div class="comment-avatar">${avHtml}</div>
        <div class="comment-bubble">
          <div class="comment-name">${c.authorName || char?.name || 'User'}</div>
          ${c.content}
        </div>
      </div>
    `;
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
    platform: currentSocialTab,
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
}

async function aiPostSocial() {
  const charId = document.getElementById('social-post-char-select').value;
  const promptText = document.getElementById('social-post-prompt').value.trim();
  const imageOption = document.getElementById('social-image-option').value;

  const char = state.chars.find(c => c.id === charId);
  if (!char) return;
  closeModal('social-compose-modal');
  showToast('✍️ 角色正在發文...');

  try {
    // 社群貼文使用 gemini-2.0-flash，完全不套用 regex，字數更長
    const postPrompt = `你是 ${char.name}。${char.desc?.slice(0,300)||''}
發一則${currentSocialTab === 'plurk' ? '噗浪' : 'Instagram'}貼文。${promptText ? `主題：${promptText}` : '自由發揮，符合你的個性。'}
字數150-400字，自然口語，有情感有細節，像真人在分享生活。${currentSocialTab === 'plurk' ? '可以加幾個 hashtag。' : '不要加 hashtag。'}
只輸出貼文內容，不要加任何說明或標題。`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: postPrompt }] }],
        generationConfig: { maxOutputTokens: 800 }  // 不限制太短
      })
    });
    const data = await res.json();
    // 直接取全文，不套 regex
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '（無法生成貼文）';

    let imageUrl = null;
    if (imageOption !== 'none') {
      try {
        const imgPrompt = `${currentSocialTab === 'ig' ? 'Instagram photo' : 'Anime illustration'}. ${char.name}. ${imageOption === 'selfie' ? 'Selfie style, character looking at camera.' : 'Scene matching: ' + content.slice(0,100)} Soft pastel aesthetic.`;
        imageUrl = await callGeminiImage(imgPrompt);
      } catch(e) { /* image gen optional */ }
    }

    const post = {
      id: uid(),
      charId: char.id,
      platform: currentSocialTab,
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
    // 不再呼叫 aiReactToPost（移除角色互相回覆）
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

async function aiReplyToComment(postId, userComment) {
  const post = state.socialPosts.find(p => p.id === postId);
  if (!post) return;
  const char = state.chars.find(c => c.id === post.charId);
  if (!char) return;

  try {
    const prompt = `你是 ${char.name}。你剛發了一篇貼文：「${post.content}」
有人回覆說：「${userComment}」
寫一個自然的回覆（1-2句話）。只輸出回覆內容。`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 150 } })
    });
    const data = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (reply) {
      post.comments.push({ id: uid(), charId: char.id, authorName: char.name, content: reply, time: Date.now() });
      await dbPut('socialPosts', post);
      if (currentSocialTab === post.platform) renderSocialFeed();
    }
  } catch(e) { /* silent */ }
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
  renderDiaryCalendar();
  const label = document.getElementById('diary-month-label');
  label.textContent = state.diaryMonth.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' });
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

  // Check if we have entries for this date
  const entries = [];
  state.chars.forEach(char => {
    const charEntries = state.diaryEntries[char.id] || {};
    if (charEntries[dateStr]) {
      entries.push({ char, content: charEntries[dateStr] });
    }
  });

  if (entries.length) {
    content.innerHTML = entries.map(e => {
      const av = e.char.avatar;
      const avHtml = av?.startsWith('http') ? `<img src="${av}">` : (av || '🌸');
      return `
        <div class="diary-entry" style="margin-bottom:1rem;">
          <div class="diary-entry-date">${new Date(dateStr).toLocaleDateString('zh-TW', {year:'numeric',month:'long',day:'numeric'})}</div>
          <div class="diary-entry-char">
            <div class="diary-char-avatar">${avHtml}</div>
            <div class="diary-char-name">${e.char.name} 的日記</div>
          </div>
          <div class="diary-entry-text">${e.content}</div>
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

  content.innerHTML = `
    <div style="text-align:center;padding:2rem;">
      <div style="font-size:1.5rem;margin-bottom:0.8rem;">📔</div>
      <div style="font-size:0.88rem;color:var(--text-mid);margin-bottom:1rem;">${dateStr} 的日記尚未生成</div>
      <button onclick="generateDiary('${dateStr}')" style="padding:0.7rem 1.5rem;background:linear-gradient(135deg,var(--lavender),var(--milk-blue));border:none;border-radius:14px;color:white;font-family:inherit;font-size:0.88rem;cursor:pointer;">✨ 生成日記</button>
    </div>
  `;
}

async function generateDiary(dateStr) {
  if (state.chars.length === 0) return;
  showToast('📔 生成日記中...');

  for (const char of state.chars) {
    try {
      // Get chat history context from around that date
      const chatContext = state.chats
        .filter(c => c.charId === char.id)
        .flatMap(c => c.messages)
        .filter(m => {
          const d = new Date(m.time).toLocaleDateString('zh-TW').replace(/\//g,'-');
          return Math.abs(new Date(m.time) - new Date(dateStr)) < 86400000 * 3;
        })
        .slice(-10)
        .map(m => `${m.role}: ${m.content}`).join('\n');

      const memories = Object.values(state.memory).flat().map(m => m?.text).filter(Boolean).slice(0,5).join(', ');

      const prompt = `你是 ${char.name}。${char.desc?.slice(0,200)||''}
今天是 ${dateStr}。請以第一人稱寫一篇日記（繁體中文，200-350字）。
${chatContext ? `今天和你重要的人發生了這些事：\n${chatContext}` : '描述你想像中的一天'}
${memories ? `重要的記憶：${memories}` : ''}
日記要有感情，像真人在寫，有細節，有感受。`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${state.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 600 } })
      });
      const data = await res.json();
      const diaryText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (diaryText) {
        if (!state.diaryEntries[char.id]) state.diaryEntries[char.id] = {};
        state.diaryEntries[char.id][dateStr] = diaryText;
        await dbPut('diaryEntries', { id: char.id, entries: state.diaryEntries[char.id] });
      }
    } catch(e) { /* silent per char */ }
  }

  renderDiaryCalendar();
  await loadDiaryForDate(dateStr);
  showToast('✓ 日記已生成');
}

// ─── SPELL STAGE（獨立咒語舞台，原 CCTV 頁） ─────────────────
let spellStageHistory = []; // [{role:'user'|'model', parts:[{text}]}]
let spellStageCharId = null;
let spellStageSystem = '';

function renderSpellStage() {
  const page = document.getElementById('cctv-page');
  if (!page) return;
  // 只重新渲染角色選擇行
  const charRow = document.getElementById('cctv-char-row');
  charRow.innerHTML = state.chars.length
    ? state.chars.map(c => {
        const av = c.avatar?.startsWith('data:') || c.avatar?.startsWith('http')
          ? `<img src="${c.avatar}" style="width:22px;height:22px;border-radius:6px;object-fit:cover;">`
          : `<span>${c.avatar||'🌸'}</span>`;
        return `<div class="cctv-char-chip ${spellStageCharId===c.id?'active':''}" onclick="selectSpellStageChar('${c.id}')">${av} ${c.name}</div>`;
      }).join('')
    : '<div style="color:rgba(201,184,232,0.4);font-size:0.82rem;padding:0.5rem;">請先建立角色</div>';
}

function selectSpellStageChar(charId) {
  spellStageCharId = charId;
  spellStageHistory = [];
  renderSpellStage();
  // 清空對話區
  const msgArea = document.getElementById('spell-stage-messages');
  if (msgArea) {
    msgArea.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--text-light);font-size:0.85rem;">
      已選擇角色，在下方輸入咒語場景後按「開始」<br>
      <span style="font-size:0.75rem;opacity:0.7">此頁面不套用 regex，可閱讀完整長篇回覆</span>
    </div>`;
  }
  const char = state.chars.find(c => c.id === charId);
  if (char) showToast(`✨ 已選擇 ${char.name}`);
}

async function startSpellStage() {
  const scenarioInput = document.getElementById('spell-stage-scenario');
  const scenario = scenarioInput?.value?.trim();
  if (!spellStageCharId) { showToast('請先選擇角色'); return; }
  if (!scenario) { showToast('請輸入場景描述'); return; }

  const char = state.chars.find(c => c.id === spellStageCharId);
  if (!char) return;

  // 建立系統提示
  const memories = Object.values(state.memory).flat().map(m => m?.text).filter(Boolean).slice(0,5).join('\n');
  const recentChat = state.activeChat
    ? (state.chats.find(c=>c.id===state.activeChat)?.messages||[]).slice(-8).map(m=>`${m.role==='user'?'user':char.name}: ${m.content}`).join('\n')
    : '';

  spellStageSystem = `你是 ${char.name}，正在與 user 進行一場沉浸式小劇場。
角色設定：${char.desc||''}

${memories ? `[長期記憶]\n${memories}` : ''}
${recentChat ? `[近期聊天背景]\n${recentChat}` : ''}

[場景設定]
${scenario}

重要規則：
- 這是獨立的小劇場空間，完全不影響主聊天記錄
- 可以寫得更長、更有文學性、更多動作描述和內心獨白
- 以繁體中文回應，不限字數，盡情投入角色
- 不要用 * 包裹動作，改用（括號）表示動作和表情`;

  spellStageHistory = [];
  scenarioInput.value = '';

  const msgArea = document.getElementById('spell-stage-messages');
  if (msgArea) msgArea.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-light);font-size:0.8rem;font-style:italic;">✨ 小劇場開始 — ${char.name}</div>`;

  await sendSpellStageMessage('（場景開始）');
}

async function sendSpellStageMsg() {
  const input = document.getElementById('spell-stage-input');
  const text = input?.value?.trim();
  if (!text) return;
  if (!spellStageCharId) { showToast('請先選擇角色並開始場景'); return; }
  input.value = '';
  await sendSpellStageMessage(text);
}

async function sendSpellStageMessage(userText) {
  if (!spellStageCharId) return;
  const char = state.chars.find(c => c.id === spellStageCharId);
  if (!char) return;

  const msgArea = document.getElementById('spell-stage-messages');
  if (!msgArea) return;

  // 顯示 user 訊息（非開始指令）
  if (userText !== '（場景開始）') {
    const userDiv = document.createElement('div');
    userDiv.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:0.8rem;';
    userDiv.innerHTML = `<div style="max-width:75%;background:linear-gradient(135deg,var(--lavender),var(--milk-blue));color:white;border-radius:18px 18px 4px 18px;padding:0.75rem 1rem;font-size:0.88rem;line-height:1.6;white-space:pre-wrap;">${userText.replace(/</g,'&lt;')}</div>`;
    msgArea.appendChild(userDiv);
  }

  // 顯示 typing 指示
  const av = char.avatar?.startsWith('data:')||char.avatar?.startsWith('http')
    ? `<img src="${char.avatar}" style="width:32px;height:32px;border-radius:10px;object-fit:cover;flex-shrink:0;">`
    : `<span style="font-size:1.4rem;flex-shrink:0;">${char.avatar||'🌸'}</span>`;

  const typingDiv = document.createElement('div');
  typingDiv.id = 'spell-stage-typing';
  typingDiv.style.cssText = 'display:flex;align-items:center;gap:0.6rem;margin-bottom:0.8rem;';
  typingDiv.innerHTML = `${av}<div style="background:rgba(255,255,255,0.9);border-radius:4px 18px 18px 18px;padding:0.6rem 0.9rem;box-shadow:0 2px 8px rgba(180,160,210,0.18);"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
  msgArea.appendChild(typingDiv);
  msgArea.scrollTop = msgArea.scrollHeight;

  // 加入歷史
  spellStageHistory.push({ role: 'user', parts: [{ text: userText }] });

  try {
    // Gemini API 格式：system_instruction 獨立，contents 是對話歷史
    const body = {
      system_instruction: { parts: [{ text: spellStageSystem }] },
      contents: spellStageHistory.map(m => ({ role: m.role, parts: m.parts })),
      generationConfig: {
        temperature: state.temperature || 1.0,
        maxOutputTokens: 2048
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(errMsg);
    }

    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!replyText) {
      const reason = data.candidates?.[0]?.finishReason || '未知原因';
      throw new Error(`未收到回覆 (${reason})`);
    }

    spellStageHistory.push({ role: 'model', parts: [{ text: replyText }] });

    // 移除 typing
    document.getElementById('spell-stage-typing')?.remove();

    // 顯示回覆（完整長篇，不套 regex）
    const aiDiv = document.createElement('div');
    aiDiv.style.cssText = 'display:flex;align-items:flex-start;gap:0.6rem;margin-bottom:1.4rem;';
    aiDiv.innerHTML = `${av}<div style="flex:1;background:rgba(255,255,255,0.92);border-radius:4px 18px 18px 18px;padding:1rem 1.2rem;font-size:0.9rem;line-height:1.9;color:var(--text-dark);white-space:pre-wrap;box-shadow:0 2px 12px rgba(180,160,210,0.18);word-break:break-word;">${replyText.replace(/</g,'&lt;')}</div>`;
    msgArea.appendChild(aiDiv);
    msgArea.scrollTop = msgArea.scrollHeight;

  } catch(e) {
    document.getElementById('spell-stage-typing')?.remove();
    // 從歷史移除失敗的 user 訊息，以便重試
    spellStageHistory.pop();
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'text-align:center;color:#e87878;font-size:0.82rem;padding:0.6rem 1rem;background:rgba(232,120,120,0.08);border-radius:10px;margin-bottom:0.8rem;';
    errDiv.textContent = `⚠️ 錯誤：${e.message}`;
    msgArea.appendChild(errDiv);
    msgArea.scrollTop = msgArea.scrollHeight;
  }
}

function clearSpellStage() {
  spellStageHistory = [];
  const msgArea = document.getElementById('spell-stage-messages');
  if (msgArea) msgArea.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--text-light);font-size:0.85rem;">咒語舞台已清空</div>`;
  showToast('✓ 已清空對話');
}

function handleSpellStageKey(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendSpellStageMsg();
  }
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


function checkRealWorldEvents() {
  if (!state.realWorldEvents) return;
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const hour = today.getHours();

  if (hour !== 9 && hour !== 12) return; // Only trigger at 9am and noon

  const events = [
    { month: 2, day: 14, msg: '情人節快樂！今天有什麼特別的計劃嗎？我想和你一起度過這一天 💕' },
    { month: 12, day: 25, msg: '聖誕節快樂！🎄 今天有沒有好好慶祝？' },
    { month: 1, day: 1, msg: '新年快樂！新的一年也請多多關照我喔 🌟' },
  ];

  // Birthday check
  if (state.userBirthday) {
    const [bYear, bMonth, bDay] = state.userBirthday.split('-').map(Number);
    if (month === bMonth && day === bDay) {
      triggerSpecialMessage('今天是你的生日！🎂 生日快樂～！我特別為你準備了一個驚喜，等你來發現喔！');
      return;
    }
  }

  const event = events.find(e => e.month === month && e.day === day);
  if (event) triggerSpecialMessage(event.msg);
}

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
  // 優先用自訂輸入，否則用下拉
  const customModel = document.getElementById('model-custom-input')?.value?.trim();
  const selectModel = document.getElementById('model-update-select')?.value;
  const model = customModel || selectModel || state.model;
  const temp = parseFloat(document.getElementById('temp-slider').value);
  const maxTok = parseInt(document.getElementById('max-tokens-input').value);

  if (key) {
    state.apiKey = key;
    localStorage.setItem('erh_key', key);
    document.getElementById('api-key-display').textContent = '••••' + key.slice(-4);
  }
  state.model = model;
  state.temperature = temp;
  state.maxTokens = maxTok;
  localStorage.setItem('erh_model', model);
  document.getElementById('current-model-display').textContent = modelShortName(model);
  closeModal('model-settings-modal');
  showToast('✓ 設定已儲存，模型：' + modelShortName(model));
}

function openApiSettings() {
  document.getElementById('api-key-update').value = state.apiKey;
  // 顯示當前模型到自訂欄位
  const customInput = document.getElementById('model-custom-input');
  if (customInput) customInput.value = state.model;
  // 嘗試同步下拉選單
  const sel = document.getElementById('model-update-select');
  if (sel) {
    const opt = sel.querySelector(`option[value="${state.model}"]`);
    if (opt) sel.value = state.model;
  }
  openModal('model-settings-modal');
}

function toggleRealWorldEvents() {
  state.realWorldEvents = !state.realWorldEvents;
  const toggle = document.getElementById('realworld-toggle');
  toggle.classList.toggle('on', state.realWorldEvents);
  saveSettings();
}

// ─── CONTEXT MENU ────────────────────────────────────
let longPressTimer = null;

function handleLongPress(msgId, e) {
  longPressTimer = setTimeout(() => {
    const touch = e.touches[0];
    showCtxMenu({ clientX: touch.clientX, clientY: touch.clientY }, msgId);
  }, 500);
}

function clearLongPress() {
  clearTimeout(longPressTimer);
}

function showCtxMenu(e, msgId) {
  state.ctxTargetMsgId = msgId;
  const menu = document.getElementById('ctx-menu');
  menu.classList.add('open');
  const x = Math.min(e.clientX, window.innerWidth - 180);
  const y = Math.min(e.clientY, window.innerHeight - 150);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
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
    if (!confirm('確認刪除這則訊息？')) return;
    chat.messages = chat.messages.filter(m => m.id !== state.ctxTargetMsgId);
    dbPut('chats', chat);
    renderMessages(state.activeChat);
  } else if (action === 'regen') {
    regenLastMessage();
  } else if (action === 'edit') {
    const newContent = prompt('編輯訊息：', msg.content);
    if (newContent !== null) {
      msg.content = newContent;
      dbPut('chats', chat);
      renderMessages(state.activeChat);
    }
  }
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
  if (id === 'lorebook-modal') renderLorebookList();
  if (id === 'persona-modal') renderPersonaList();
  if (id === 'preset-modal') {
    document.getElementById('system-prompt-input').value = state.systemPrompt;
    document.getElementById('jailbreak-input').value = state.jailbreak;
    document.getElementById('jailbreak-position').value = state.jailbreakPosition;
    document.getElementById('regex-input').value = state.regexRules;
  }
  if (id === 'social-compose-modal') {
    const sel = document.getElementById('social-post-char-select');
    sel.innerHTML = state.chars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
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
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
    e.preventDefault();
    sendMessage();
  }
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

// ─── INIT ────────────────────────────────────────────
(async () => {
  try {
    await initDB();
    await loadAllData();
  } catch(e) { console.warn('DB init:', e); }

  // Check saved credentials
  const savedKey = localStorage.getItem('erh_key');
  const savedModel = localStorage.getItem('erh_model');

  if (savedKey) {
    document.getElementById('api-key-input').value = savedKey;
    if (savedModel) document.getElementById('model-select').value = savedModel;
    enterApp();
  }

  // Init birthday field
  document.getElementById('birthday-input').value = state.userBirthday;
  document.getElementById('birthday-input').addEventListener('change', e => {
    state.userBirthday = e.target.value;
    saveSettings();
  });

  // Real world toggle init
  const toggle = document.getElementById('realworld-toggle');
  toggle.classList.toggle('on', state.realWorldEvents);

  // AutoMsg toggle init
  const autoToggle = document.getElementById('automsg-toggle');
  if (autoToggle) autoToggle.classList.toggle('on', state.autoMsgEnabled);
  const autoHoursInput = document.getElementById('automsg-hours-input');
  if (autoHoursInput) autoHoursInput.value = state.autoMsgHours;
})();
