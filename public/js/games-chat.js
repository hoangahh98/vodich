(() => {
  const stage = document.querySelector('[data-game="chat"]');
  if (!stage) return;
  const { speak } = window.GameCore;
  const win = stage.querySelector('[data-chat-window]');
  const tipEl = stage.querySelector('[data-chat-tip]');
  const micBtn = stage.querySelector('[data-chat-mic]');
  const textInput = stage.querySelector('[data-chat-text]');
  const sendBtn = stage.querySelector('[data-chat-send]');
  const aiOn = stage.getAttribute('data-ai') === '1';
  const messages = [];
  let busy = false;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null;
  let listening = false;
  let micTimer = null;

  const stopListening = () => {
    listening = false;
    micBtn.classList.remove('listening');
    clearTimeout(micTimer);
    micTimer = null;
  };

  if (SR) {
    try {
      recog = new SR();
      recog.lang = 'en-US';
      recog.interimResults = false;
      recog.maxAlternatives = 1;
      recog.continuous = false;
      recog.onstart = () => {
        listening = true;
        micBtn.classList.add('listening');
      };
      recog.onresult = (e) => {
        stopListening();
        const said = e && e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '';
        if (said) send(said);
      };
      recog.onend = stopListening;
      recog.onerror = (e) => {
        stopListening();
        if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
          tipEl.textContent = '🎤 Chưa cấp quyền micro — hãy gõ chữ hoặc bật quyền micro cho trang.';
        }
      };
    } catch (_) {
      recog = null;
    }
  }
  if (!recog) {
    micBtn.disabled = true;
    micBtn.title = 'Trình duyệt không hỗ trợ micro, hãy gõ chữ';
  }

  function bubble(role, text) {
    const row = document.createElement('div');
    row.className = 'chat-msg ' + (role === 'user' ? 'chat-user' : 'chat-ai');
    row.innerHTML = role === 'user'
      ? `<div class="chat-bubble"></div><span class="chat-avatar">🧒</span>`
      : `<span class="chat-avatar">👩‍🦰</span><div class="chat-bubble"></div>`;
    row.querySelector('.chat-bubble').textContent = text;
    win.appendChild(row);
    win.scrollTop = win.scrollHeight;
    return row;
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy || !aiOn) return;
    busy = true;
    tipEl.textContent = '';
    bubble('user', text);
    messages.push({ role: 'user', text });
    textInput.value = '';
    const thinking = bubble('ai', '...');
    try {
      const res = await fetch('/games/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      const data = await res.json();
      if (data.reply) {
        thinking.querySelector('.chat-bubble').textContent = data.reply;
        messages.push({ role: 'ai', text: data.reply });
        speak(data.reply);
        if (data.tip) tipEl.textContent = '💡 ' + data.tip;
      } else {
        thinking.querySelector('.chat-bubble').textContent = data.error || 'Ối, thử lại nhé!';
      }
    } catch (_) {
      thinking.querySelector('.chat-bubble').textContent = 'Mạng có vấn đề, thử lại nhé!';
    } finally {
      busy = false;
    }
  }

  micBtn.addEventListener('click', () => {
    if (!recog || busy) return;
    if (listening) {
      try { recog.stop(); } catch (_) {}
      stopListening();
      return;
    }
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel(); // tránh xung đột TTS/mic
      recog.start();
      // An toàn: tự dừng sau 8s nếu không có kết quả để UI không bị kẹt.
      micTimer = setTimeout(() => {
        try { recog.stop(); } catch (_) {}
        stopListening();
      }, 8000);
    } catch (_) {
      stopListening();
    }
  });
  sendBtn.addEventListener('click', () => send(textInput.value));
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send(textInput.value);
  });
})();
