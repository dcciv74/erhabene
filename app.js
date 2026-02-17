// ═══════════════════════════════════════════════════════
//  erhabene — app.js
//  Pure frontend, IndexedDB for persistence
// ═══════════════════════════════════════════════════════

// ─── STATE ───────────────────────────────────────────
let DB = null;
let state = {
  apiKey: '',
  model: 'gemini-2.5-pro-preview-06-05',
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

  // sidebar logic
  const sidebar = document.getElementById('sidebar');
  const sidebarTitle = document.getElementById('sidebar-title');
  const sidebarAddBtn = document.getElementById('sidebar-add-btn');

  if (page === 'chat') {
    sidebarTitle.textContent = '聊天';
    sidebarAddBtn.textContent = '＋ 新增對話';
    sidebarAddBtn.onclick = showAddChatOrChar;
    renderSidebar();
    sidebar.classList.remove('mobile-open');
  } else if (page === 'chars') {
    sidebar.classList.add('mobile-open');
    renderSidebar('chars');
    sidebarTitle.textContent = '角色';
    sidebarAddBtn.textContent = '＋ 新增角色';
    sidebarAddBtn.onclick = () => openModal('add-char-modal');
    renderCharsGrid();
  } else if (page === 'social') {
    renderSocialFeed();
    sidebar.classList.remove('mobile-open');
  } else if (page === 'diary') {
    initDiary();
    sidebar.classList.remove('mobile-open');
  } else if (page === 'cctv') {
    renderCCTV();
    sidebar.classList.remove('mobile-open');
  } else if (page === 'settings') {
    sidebar.classList.remove('mobile-open');
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
async function callGeminiImage(prompt) {
  // Gemini 2.0 Flash / Imagen for image generation
  const imageModel = 'gemini-2.0-flash-preview-image-generation';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${state.apiKey}`;
  
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error('Image gen failed: ' + res.status);
  const data = await res.json();
  
  const parts = data.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.mimeType?.startsWith('image/')) {
      return 'data:' + part.inlineData.mimeType + ';base64,' + part.inlineData.data;
    }
  }
  throw new Error('No image in response');
}

async function triggerImageGen() {
  if (!state.activeChat) return;
  const chat = state.chats.find(c => c.id === state.activeChat);
  const char = state.chars.find(c => c.id === chat?.charId);
  if (!char) return;

  showToast('🖼️ 正在生成圖片...');
  try {
    // Build context-aware prompt
    const recentMsgs = chat.messages.slice(-5).map(m => m.content).join(' ');
    const prompt = `Anime style illustration. Character: ${char.name}. ${char.desc?.slice(0,100) || ''}. Scene based on recent conversation: ${recentMsgs.slice(0,200)}. Soft watercolor aesthetic, pastel colors.`;
    const imageUrl = await callGeminiImage(prompt);
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
function getLorebookMatches(text) {
  return state.lorebook
    .filter(entry => entry.enabled && entry.keywords.some(kw => text.includes(kw)))
    .map(entry => entry.content);
}

function renderLorebookList() {
  const list = document.getElementById('lorebook-list');
  list.innerHTML = state.lorebook.map(e => `
    <div style="background:var(--lavender-soft);border-radius:12px;padding:0.7rem 0.9rem;margin-bottom:0.5rem;border:1px solid rgba(201,184,232,0.2);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.4rem;">
        <div style="font-size:0.78rem;color:var(--lavender);font-weight:500">關鍵字: ${e.keywords.join(', ')}</div>
        <div style="display:flex;gap:0.3rem;">
          <input type="checkbox" ${e.enabled ? 'checked' : ''} onchange="toggleLorebook('${e.id}',this.checked)" style="cursor:pointer">
          <button onclick="deleteLorebook('${e.id}')" style="background:none;border:none;cursor:pointer;color:#e87878;font-size:0.8rem">×</button>
        </div>
      </div>
      <div style="font-size:0.82rem;color:var(--text-dark)">${e.content.slice(0,100)}...</div>
    </div>
  `).join('') || '<div style="text-align:center;color:var(--text-light);font-size:0.82rem;padding:1rem;">還沒有 Lorebook 條目</div>';
}

function addLorebookEntry() {
  const keywords = prompt('輸入關鍵字（用逗號分隔）：');
  if (!keywords) return;
  const content = prompt('輸入內容：');
  if (!content) return;
  const entry = {
    id: uid(),
    keywords: keywords.split(',').map(k => k.trim()),
    content,
    enabled: true
  };
  state.lorebook.push(entry);
  dbPut('lorebook', entry);
  renderLorebookList();
}

function toggleLorebook(id, enabled) {
  const e = state.lorebook.find(l => l.id === id);
  if (e) { e.enabled = enabled; dbPut('lorebook', e); }
}

function deleteLorebook(id) {
  state.lorebook = state.lorebook.filter(l => l.id !== id);
  dbDelete('lorebook', id);
  renderLorebookList();
}

async function saveLorebook() {
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

  const char = {
    id: uid(),
    name,
    avatar: document.getElementById('char-avatar-input').value.trim() || '🌸',
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

  // Auto-create first chat
  await createNewChat(char.id);
}

function showCharInfo(charId) {
  const char = state.chars.find(c => c.id === charId);
  if (!char) return;
  const av = char.avatar;
  const avEl = document.getElementById('char-info-avatar');
  avEl.innerHTML = av?.startsWith('http') ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:24px;">` : (av || '🌸');
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

function newChatWithChar() {
  if (!state.activeCharId) return;
  createNewChat(state.activeCharId);
  closeModal('char-info-modal');
}

function editChar() {
  // Pre-fill add char modal with existing data
  const char = state.chars.find(c => c.id === state.activeCharId);
  if (!char) return;
  closeModal('char-info-modal');
  document.getElementById('char-name-input').value = char.name;
  document.getElementById('char-avatar-input').value = char.avatar || '';
  document.getElementById('char-desc-input').value = char.desc || '';
  document.getElementById('char-first-msg-input').value = char.firstMsg || '';
  openModal('add-char-modal');
}

function openImportModal() { openModal('add-char-modal'); }

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

  // AI characters react after a delay
  if (state.chars.length) {
    setTimeout(() => aiReactToPost(post.id), 2000);
  }
}

async function aiPostSocial() {
  const charId = document.getElementById('social-post-char-select').value;
  const promptText = document.getElementById('social-post-prompt').value.trim();
  const imageOption = document.getElementById('social-image-option').value;
  const replyLimit = parseInt(document.getElementById('reply-limit-input').value) || 3;

  const char = state.chars.find(c => c.id === charId);
  if (!char) return;
  closeModal('social-compose-modal');
  showToast('✍️ 角色正在發文...');

  try {
    // Generate post content
    const postPrompt = `你是 ${char.name}。${char.desc?.slice(0,200)||''}
發一則${currentSocialTab === 'plurk' ? '噗浪' : 'Instagram'}貼文。${promptText ? `主題：${promptText}` : '自由發揮，符合你的個性。'}
字數50-150字，自然口語，不要用hashtag（噗浪除外）。只輸出貼文內容，不要加說明。`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: postPrompt }] }], generationConfig: { maxOutputTokens: 300 } })
    });
    const data = await res.json();
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

    // Other chars react with limit
    setTimeout(() => aiReactToPost(post.id, replyLimit), 1500);
  } catch(err) {
    showToast('發文失敗：' + err.message);
  }
}

async function aiReactToPost(postId, maxReplies = 3) {
  const post = state.socialPosts.find(p => p.id === postId);
  if (!post) return;

  const reactors = state.chars.filter(c => c.id !== post.charId).slice(0, maxReplies);
  
  for (const reactor of reactors) {
    await delay(1500 + Math.random() * 2000);
    try {
      const prompt = `你是 ${reactor.name}。${reactor.desc?.slice(0,150)||''}
看到這篇貼文：「${post.content}」
寫一個自然的留言回覆（1-2句話，符合你的個性）。只輸出留言內容。`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${state.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 150 } })
      });
      const data = await res.json();
      const comment = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (comment) {
        post.comments = post.comments || [];
        post.comments.push({
          id: uid(),
          charId: reactor.id,
          authorName: reactor.name,
          content: comment,
          time: Date.now(),
        });
        await dbPut('socialPosts', post);
        if (currentSocialTab === post.platform) renderSocialFeed();
      }
    } catch(e) { /* silent */ }
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

// ─── CCTV ────────────────────────────────────────────
function renderCCTV() {
  const charRow = document.getElementById('cctv-char-row');
  const content = document.getElementById('cctv-content');

  if (!state.chars.length) {
    charRow.innerHTML = '';
    content.innerHTML = `<div style="text-align:center;padding:3rem;color:rgba(201,184,232,0.4);font-size:0.88rem;">還沒有角色可監視</div>`;
    return;
  }

  charRow.innerHTML = state.chars.map(c => `
    <div class="cctv-char-chip ${state.cctvCharId === c.id ? 'active' : ''}" onclick="selectCCTVChar('${c.id}')">
      <div class="cctv-chip-dot"></div>
      ${c.name}
    </div>
  `).join('');

  if (!state.cctvCharId) {
    state.cctvCharId = state.chars[0].id;
    document.querySelector('.cctv-char-chip')?.classList.add('active');
  }

  generateCCTVActivity();
}

async function selectCCTVChar(charId) {
  state.cctvCharId = charId;
  document.querySelectorAll('.cctv-char-chip').forEach(c => c.classList.remove('active'));
  document.querySelector(`[onclick="selectCCTVChar('${charId}')"]`)?.classList.add('active');
  generateCCTVActivity();
}

async function refreshCCTV() {
  generateCCTVActivity();
}

async function generateCCTVActivity() {
  const char = state.chars.find(c => c.id === state.cctvCharId);
  if (!char) return;
  const content = document.getElementById('cctv-content');

  content.innerHTML = `
    <div class="cctv-screen">
      <div class="cctv-screen-header">
        <div class="cctv-cam-label">CAM-01 · ${char.name}</div>
        <div class="cctv-timestamp" id="cctv-time">${new Date().toLocaleTimeString('zh-TW')}</div>
      </div>
      <div class="cctv-screen-body">
        <div class="cctv-activity-list" id="cctv-activities">
          <div style="color:rgba(201,184,232,0.4);font-size:0.82rem;text-align:center;padding:1rem;">載入中...</div>
        </div>
      </div>
    </div>
  `;

  try {
    const now = new Date();
    const hours = Array.from({length: 12}, (_, i) => {
      const h = now.getHours() - 11 + i;
      return { h: (h + 24) % 24, label: String((h+24)%24).padStart(2,'0') + ':' + String(Math.floor(Math.random()*4)*15).padStart(2,'0') };
    });

    const prompt = `你是 ${char.name}。${char.desc?.slice(0,150)||''}
今天是 ${now.toLocaleDateString('zh-TW')}。
生成這個角色今天的行動日誌（JSON格式）。每個時段一個活動。
時段：${hours.map(h=>h.label).join(', ')}
格式：[{"time":"HH:MM","activity":"正在做什麼（20字以內）"}]
活動要符合角色個性，自然真實。只輸出JSON。`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${state.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 600 } })
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '[]';
    const clean = text.replace(/```json|```/g,'').trim();
    const activities = JSON.parse(clean);

    const listEl = document.getElementById('cctv-activities');
    if (listEl) {
      listEl.innerHTML = activities.map(a => `
        <div class="cctv-activity-item">
          <div class="cctv-act-time">${a.time}</div>
          <div class="cctv-act-text">${a.activity}</div>
        </div>
      `).join('');
    }
  } catch(e) {
    const listEl = document.getElementById('cctv-activities');
    if (listEl) listEl.innerHTML = '<div style="color:rgba(201,184,232,0.4);font-size:0.82rem;text-align:center;padding:1rem;">無法載入活動記錄</div>';
  }

  // Update timestamp
  setInterval(() => {
    const t = document.getElementById('cctv-time');
    if (t) t.textContent = new Date().toLocaleTimeString('zh-TW');
  }, 1000);
}

// ─── REAL WORLD EVENTS ──────────────────────────────
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
})();
