(() => {
  const stage = document.querySelector('[data-game="advanced"]');
  if (!stage) return;
  const { speak } = window.GameCore;
  const win = stage.querySelector('[data-chat-window]');
  const tipEl = stage.querySelector('[data-chat-tip]');
  const micBtn = stage.querySelector('[data-chat-mic]');
  const textInput = stage.querySelector('[data-chat-text]');
  const sendBtn = stage.querySelector('[data-chat-send]');
  const startBtn = stage.querySelector('[data-chat-start]');
  const suggestBox = stage.querySelector('[data-suggest]');
  const suggestEn = stage.querySelector('[data-suggest-en]');
  const suggestVi = stage.querySelector('[data-suggest-vi]');
  const aiOn = stage.getAttribute('data-ai') === '1';
  let lastSuggest = '';
  let messages = [];
  let busy = false;
  let scenario = 'free';
  let level = 'beginner';

  // --- Hồ sơ người học (lưu localStorage) ---
  const setup = stage.querySelector('[data-chat-setup]');
  const pName = stage.querySelector('[data-p-name]');
  const pAge = stage.querySelector('[data-p-age]');
  const pGender = stage.querySelector('[data-p-gender]');
  const readProfile = () => ({
    name: (pName && pName.value || '').trim(),
    age: (pAge && pAge.value || '').trim(),
    gender: (pGender && pGender.value || '').trim(),
  });
  try {
    const saved = JSON.parse(localStorage.getItem('game-advanced-profile') || '{}');
    if (saved.name && pName) pName.value = saved.name;
    if (saved.age && pAge) pAge.value = saved.age;
    if (saved.gender && pGender) pGender.value = saved.gender;
  } catch (_) {}
  const toggleBtn = stage.querySelector('[data-setup-toggle]');
  if (toggleBtn && setup) toggleBtn.addEventListener('click', () => setup.classList.toggle('hidden'));
  const saveBtn = stage.querySelector('[data-setup-save]');
  if (saveBtn && setup) saveBtn.addEventListener('click', () => {
    try { localStorage.setItem('game-advanced-profile', JSON.stringify(readProfile())); } catch (_) {}
    setup.classList.add('hidden');
    tipEl.textContent = '✅ Đã lưu thông tin của bạn!';
  });

  // --- Chọn tình huống / trình độ ---
  const pickRow = (selector, attr, onPick) => {
    const row = stage.querySelector(selector);
    if (!row) return;
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('[' + attr + ']');
      if (!btn) return;
      row.querySelectorAll('.adv-chip').forEach((c) => c.classList.toggle('active', c === btn));
      onPick(btn.getAttribute(attr));
    });
  };
  const resetConversation = () => {
    messages = [];
    win.innerHTML = '<div class="chat-msg chat-ai"><span class="chat-avatar">🎓</span><div class="chat-bubble">Đã đổi. Bấm "Bắt đầu" hoặc nói/gõ để luyện nhé!</div></div>';
    tipEl.textContent = '';
  };
  pickRow('[data-scenarios]', 'data-scenario', (v) => { scenario = v; resetConversation(); });
  pickRow('[data-levels]', 'data-level', (v) => { level = v; resetConversation(); });

  // --- Mic (Web Speech, robust) ---
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null;
  let listening = false;
  let gotResult = false;
  let micTimer = null;
  const stopListening = () => { listening = false; micBtn.classList.remove('listening'); clearTimeout(micTimer); micTimer = null; };
  if (SR) {
    try {
      recog = new SR();
      recog.lang = 'en-US';
      recog.interimResults = false;
      recog.continuous = false;
      recog.onstart = () => { listening = true; gotResult = false; micBtn.classList.add('listening'); tipEl.textContent = '🎤 Đang nghe... hãy nói!'; };
      recog.onresult = (e) => { gotResult = true; stopListening(); const t = e.results?.[0]?.[0]?.transcript || ''; if (t) send(t); else tipEl.textContent = '🤔 Chưa nghe rõ, thử nói lại hoặc gõ chữ nhé.'; };
      recog.onend = () => { const was = listening; stopListening(); if (was && !gotResult) tipEl.textContent = '🤔 Chưa nghe rõ, thử nói lại hoặc gõ chữ nhé.'; };
      recog.onerror = (e) => { stopListening(); if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) tipEl.textContent = '🎤 Chưa cấp quyền micro — hãy gõ chữ hoặc bật quyền.'; };
    } catch (_) { recog = null; }
  }
  // Web Speech cần Chrome/Edge + HTTPS; và chỉ dùng được khi server đã bật AI.
  if (!recog) { micBtn.disabled = true; micBtn.title = 'Trình duyệt không hỗ trợ micro, hãy gõ chữ'; }
  else if (!aiOn) { micBtn.disabled = true; micBtn.title = 'Chưa cấu hình AI trên server nên chưa trò chuyện được'; }

  function bubble(role, text) {
    const row = document.createElement('div');
    row.className = 'chat-msg ' + (role === 'user' ? 'chat-user' : 'chat-ai');
    row.innerHTML = role === 'user'
      ? '<div class="chat-bubble"></div><span class="chat-avatar">🧑</span>'
      : '<span class="chat-avatar">🎓</span><div class="chat-bubble"></div>';
    row.querySelector('.chat-bubble').textContent = text;
    win.appendChild(row);
    win.scrollTop = win.scrollHeight;
    return row;
  }

  async function ask(userText) {
    const thinking = bubble('ai', '...');
    try {
      const res = await fetch('/games/advanced-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, scenario, level, profile: readProfile() }),
      });
      const data = await res.json();
      if (data.reply) {
        const b = thinking.querySelector('.chat-bubble');
        b.textContent = data.reply;
        if (data.vi) {
          const vi = document.createElement('div');
          vi.className = 'chat-vi';
          vi.textContent = '🇻🇳 ' + data.vi;
          b.appendChild(vi);
        }
        messages.push({ role: 'ai', text: data.reply });
        speak(data.reply);
        tipEl.textContent = data.tip ? '✍️ ' + data.tip : '';
        showSuggest(data.suggest, data.suggestVi);
      } else {
        thinking.querySelector('.chat-bubble').textContent = data.error || 'Thử lại nhé!';
      }
    } catch (_) {
      thinking.querySelector('.chat-bubble').textContent = 'Mạng có vấn đề, thử lại nhé!';
    }
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy || !aiOn) return;
    busy = true;
    tipEl.textContent = '';
    bubble('user', text);
    messages.push({ role: 'user', text });
    textInput.value = '';
    await ask(text);
    busy = false;
  }

  async function start() {
    if (busy || !aiOn) return;
    busy = true;
    messages = [];
    tipEl.textContent = '';
    await ask('');
    busy = false;
  }

  function showSuggest(en, vi) {
    if (!suggestBox) return;
    if (!en) { suggestBox.classList.add('hidden'); lastSuggest = ''; return; }
    lastSuggest = en;
    suggestEn.textContent = en;
    suggestVi.textContent = vi ? '(' + vi + ')' : '';
    suggestBox.classList.remove('hidden');
  }

  const speakSuggest = stage.querySelector('[data-suggest-speak]');
  const useSuggest = stage.querySelector('[data-suggest-use]');
  speakSuggest && speakSuggest.addEventListener('click', () => { if (lastSuggest) speak(lastSuggest); });
  useSuggest && useSuggest.addEventListener('click', () => { if (lastSuggest && !busy) send(lastSuggest); });

  startBtn && startBtn.addEventListener('click', start);
  micBtn.addEventListener('click', () => {
    if (!recog || busy) return;
    if (listening) { try { recog.stop(); } catch (_) {} stopListening(); return; }
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      recog.start();
      micTimer = setTimeout(() => { try { recog.stop(); } catch (_) {} stopListening(); }, 8000);
    } catch (_) { stopListening(); }
  });
  sendBtn.addEventListener('click', () => send(textInput.value));
  textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(textInput.value); });
})();
