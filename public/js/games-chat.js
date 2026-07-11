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
  if (SR) {
    recog = new SR();
    recog.lang = 'en-US';
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onresult = (e) => {
      const said = e.results[0][0].transcript;
      send(said);
    };
    recog.onend = () => micBtn.classList.remove('listening');
    recog.onerror = () => micBtn.classList.remove('listening');
  } else {
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
    try {
      micBtn.classList.add('listening');
      recog.start();
    } catch (_) {
      micBtn.classList.remove('listening');
    }
  });
  sendBtn.addEventListener('click', () => send(textInput.value));
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send(textInput.value);
  });
})();
