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

  const speak = (text) => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  window.VodichScoreSpeech = Object.freeze({
    readVietnameseNumber,
    speak,
    teamSpeechName,
  });
})();
