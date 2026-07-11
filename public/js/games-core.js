// Tiện ích dùng chung cho các game trẻ em: âm thanh, phát âm, confetti, khen, HUD.
window.GameCore = (() => {
  let audioCtx = null;
  const ensureAudio = () => {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    return audioCtx;
  };

  const tone = (freq, start, duration, type = 'sine') => {
    const ctx = ensureAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration);
  };

  const sound = (kind) => {
    try {
      if (kind === 'correct') {
        tone(660, 0, 0.12);
        tone(880, 0.1, 0.16);
      } else if (kind === 'wrong') {
        tone(200, 0, 0.22, 'square');
      } else if (kind === 'win' || kind === 'cheer') {
        [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.1, 0.2));
      } else if (kind === 'pop') {
        tone(880, 0, 0.06);
        tone(1400, 0.03, 0.08);
      } else if (kind === 'rustle') {
        tone(320, 0, 0.12, 'triangle');
      } else {
        tone(440, 0, 0.08);
      }
    } catch (_) {}
  };

  const FEMALE_HINTS = ['female', 'zira', 'samantha', 'karen', 'moira', 'tessa', 'susan', 'linda', 'google us english', 'aria', 'jenny', 'sonia', 'natasha'];
  let cachedVoice = null;
  const femaleEnglishVoice = () => {
    if (cachedVoice) return cachedVoice;
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    const en = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'));
    cachedVoice =
      en.find((v) => FEMALE_HINTS.some((h) => (v.name || '').toLowerCase().includes(h))) ||
      en.find((v) => !/male/i.test(v.name) || /female/i.test(v.name)) ||
      en[0] ||
      null;
    return cachedVoice;
  };
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoice = null;
      femaleEnglishVoice();
    };
  }

  const speak = (text, lang = 'en-US') => {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang;
      utter.rate = 0.9;
      utter.pitch = 1.15; // hơi cao cho giọng nữ, thân thiện với trẻ
      const voice = femaleEnglishVoice();
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    } catch (_) {}
  };

  // Kích hoạt speechSynthesis khi người dùng chạm lần đầu (bắt buộc trên mobile).
  let ttsWarmed = false;
  const warmTts = () => {
    if (ttsWarmed || !window.speechSynthesis) return;
    ttsWarmed = true;
    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
    } catch (_) {}
  };
  document.addEventListener('pointerdown', warmTts, { once: true, capture: true });
  document.addEventListener('touchstart', warmTts, { once: true, capture: true });

  // Đọc tên vật thể bằng tiếng Việt (dùng cho các game mầm non).
  const speakVi = (text) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    warmTts();
    const doSpeak = () => {
      try {
        if (synth.speaking && synth.pending) synth.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        const voices = synth.getVoices() || [];
        const vi = voices.find((v) => (v.lang || '').toLowerCase().startsWith('vi'));
        if (vi) {
          utter.voice = vi;
          utter.lang = 'vi-VN';
        } else {
          // KHÔNG có giọng Việt: để mặc định (đừng ép vi-VN kẻo im lặng) -> vẫn ra tiếng.
          utter.voice = voices[0] || null;
        }
        utter.rate = 0.95;
        utter.pitch = 1.1;
        synth.resume();
        synth.speak(utter);
      } catch (_) {}
    };
    // Trên mobile getVoices() có thể rỗng lúc đầu (nạp bất đồng bộ) -> chờ chút.
    if ((synth.getVoices() || []).length === 0) setTimeout(doSpeak, 150);
    else doSpeak();
  };

  const PRAISES = ['Giỏi quá! 🎉', 'Tuyệt vời! 🌟', 'Chính xác! 👏', 'Siêu ghê! 🚀', 'Đỉnh của chóp! 🏆', 'Bé thông minh! 🧠'];
  const ENCOURAGE = ['Gần đúng rồi, thử lại nhé! 💪', 'Không sao đâu, cố lên! 🌈', 'Suýt nữa rồi! 😊'];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const confetti = () => {
    const emojis = ['🎉', '⭐', '🎈', '🌟', '✨', '🥳', '🍭'];
    for (let i = 0; i < 18; i++) {
      const span = document.createElement('span');
      span.className = 'game-confetti';
      span.textContent = pick(emojis);
      span.style.left = Math.random() * 100 + 'vw';
      span.style.animationDelay = Math.random() * 0.3 + 's';
      span.style.fontSize = 18 + Math.random() * 22 + 'px';
      document.body.appendChild(span);
      setTimeout(() => span.remove(), 1600);
    }
  };

  class Hud {
    constructor(stage, storageKey) {
      this.stage = stage;
      this.storageKey = storageKey;
      this.score = 0;
      this.streak = 0;
      this.best = Number(this.read()) || 0;
      this.render();
    }
    read() {
      try {
        return localStorage.getItem(this.storageKey);
      } catch (_) {
        return 0;
      }
    }
    write(value) {
      try {
        localStorage.setItem(this.storageKey, String(value));
      } catch (_) {}
    }
    correct() {
      this.score += 1;
      this.streak += 1;
      if (this.score > this.best) {
        this.best = this.score;
        this.write(this.best);
      }
      this.render();
    }
    wrong() {
      this.streak = 0;
      this.render();
    }
    render() {
      const set = (sel, val) => {
        const el = this.stage.querySelector(sel);
        if (el) el.textContent = val;
      };
      set('[data-score]', this.score);
      set('[data-streak]', this.streak);
      set('[data-best]', this.best);
    }
  }

  // Nút "Về" (và thẻ game) là link điều hướng: khi bấm hiện trạng thái để biết đã bấm.
  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('.game-back, .game-card');
    if (!link || link.dataset.navigating) return;
    if (event.metaKey || event.ctrlKey || event.button === 1) return; // mở tab mới thì bỏ qua
    link.dataset.navigating = '1';
    link.classList.add('navigating');
    if (link.classList.contains('game-back')) link.textContent = 'Đang về...';
  });

  return { sound, speak, speakVi, praise: () => pick(PRAISES), encourage: () => pick(ENCOURAGE), pick, shuffle, confetti, Hud };
})();
