(() => {
  const readVietnameseNumber = (value) => {
    const number = Number.parseInt(value, 10) || 0;
    const units = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    if (number < 10) return units[number];
    if (number === 10) return 'mười';
    if (number < 20) return number === 15 ? 'mười lăm' : `mười ${units[number % 10]}`;
    const tens = Math.floor(number / 10);
    const unit = number % 10;
    if (unit === 0) return `${units[tens]} mươi`;
    if (unit === 1) return `${units[tens]} mươi mốt`;
    if (unit === 5) return `${units[tens]} mươi lăm`;
    return `${units[tens]} mươi ${units[unit]}`;
  };

  const teamSpeechName = (name) => String(name || '').replace(/\s*\/\s*/g, ' và ');

  let sequenceToken = 0;

  const speak = (text) => {
    if (!('speechSynthesis' in window) || !text) return;
    sequenceToken += 1;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  // Đọc lần lượt từng đoạn, chèn khoảng ngắt (mặc định ~0.3s) giữa các đoạn.
  // options: { gap, rate, lang, voice } — hoặc truyền thẳng số để đặt gap.
  const speakSequence = (parts, options = {}) => {
    if (!('speechSynthesis' in window)) return;
    const { gap = 300, rate = 0.95, lang = 'vi-VN', voice = null } = typeof options === 'number' ? { gap: options } : (options || {});
    const list = (Array.isArray(parts) ? parts : [parts])
      .map((part) => String(part == null ? '' : part).trim())
      .filter(Boolean);
    if (!list.length) return;
    sequenceToken += 1;
    const token = sequenceToken;
    window.speechSynthesis.cancel();
    let index = 0;
    const playNext = () => {
      if (token !== sequenceToken || index >= list.length) return;
      const utterance = new SpeechSynthesisUtterance(list[index]);
      index += 1;
      utterance.lang = lang;
      utterance.rate = rate;
      if (voice) utterance.voice = voice;
      utterance.onend = () => {
        if (token === sequenceToken && index < list.length) window.setTimeout(playNext, gap);
      };
      window.speechSynthesis.speak(utterance);
    };
    playNext();
  };

  window.VodichScoreSpeech = Object.freeze({
    readVietnameseNumber,
    speak,
    speakSequence,
    teamSpeechName,
  });
})();
