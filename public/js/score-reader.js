(() => {
  const root = document.querySelector('[data-score-reader]');
  if (!root) return;

  const cacheKey = 'vodichFriendlyScoreReader';
  const defaults = {
    teamAName: 'Đội A',
    teamBName: 'Đội B',
    scoreA: 0,
    scoreB: 0,
    servingTeam: 'A',
    scoreOrder: 2,
    touchScore: 11,
    maxScore: 15,
  };
  let speakTimer = null;
  let voices = [];
  let state = loadState();

  const byId = (id) => document.getElementById(id);
  const refs = {
    teamAName: byId('readerTeamAName'),
    teamBName: byId('readerTeamBName'),
    teamALabel: byId('readerTeamALabel'),
    teamBLabel: byId('readerTeamBLabel'),
    teamACard: byId('readerTeamACard'),
    teamBCard: byId('readerTeamBCard'),
    scoreA: byId('readerScoreA'),
    scoreB: byId('readerScoreB'),
    touchScore: byId('readerTouchScore'),
    maxScore: byId('readerMaxScore'),
    status: byId('readerStatus'),
  };

  function loadState() {
    try {
      return { ...defaults, ...JSON.parse(window.localStorage.getItem(cacheKey) || '{}') };
    } catch (_) {
      return { ...defaults };
    }
  }

  function saveState() {
    window.localStorage.setItem(cacheKey, JSON.stringify(state));
  }

  function number(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp() {
    state.touchScore = Math.max(1, number(state.touchScore, 11));
    state.maxScore = Math.max(state.touchScore, number(state.maxScore, 15));
    state.scoreA = Math.min(Math.max(0, number(state.scoreA, 0)), state.maxScore);
    state.scoreB = Math.min(Math.max(0, number(state.scoreB, 0)), state.maxScore);
    state.scoreOrder = state.scoreOrder === 1 ? 1 : 2;
    state.servingTeam = state.servingTeam === 'B' ? 'B' : 'A';
  }

  function winnerTeam() {
    const high = Math.max(state.scoreA, state.scoreB);
    const diff = Math.abs(state.scoreA - state.scoreB);
    if (state.scoreA === state.scoreB) return '';
    if (high >= state.maxScore || (high >= state.touchScore && diff >= 2)) return state.scoreA > state.scoreB ? 'A' : 'B';
    return '';
  }

  function canChange(team, delta) {
    if (team !== state.servingTeam) return false;
    const score = team === 'A' ? state.scoreA : state.scoreB;
    if (delta < 0) return score > 0;
    return !winnerTeam() && score < state.maxScore;
  }

  function status(message, className = 'muted') {
    refs.status.textContent = message || '';
    refs.status.className = `score-save-status ${className}`;
  }

  function render() {
    clamp();
    refs.teamAName.value = state.teamAName;
    refs.teamBName.value = state.teamBName;
    refs.teamALabel.textContent = state.teamAName || 'Đội A';
    refs.teamBLabel.textContent = state.teamBName || 'Đội B';
    refs.scoreA.textContent = state.scoreA;
    refs.scoreB.textContent = state.scoreB;
    refs.touchScore.value = state.touchScore;
    refs.maxScore.value = state.maxScore;
    refs.teamACard.classList.toggle('serving', state.servingTeam === 'A');
    refs.teamBCard.classList.toggle('serving', state.servingTeam === 'B');
    document.querySelectorAll('[data-reader-order]').forEach((button) => {
      const active = Number(button.dataset.readerOrder) === state.scoreOrder;
      button.classList.toggle('btn-primary', active);
    });
    document.querySelectorAll('[data-reader-delta]').forEach((button) => {
      button.disabled = !canChange(button.dataset.readerTeam, Number(button.dataset.readerDelta));
    });
    saveState();
  }

  function scoreText() {
    const speech = window.VodichScoreSpeech || {};
    const read = speech.readVietnameseNumber || ((value) => String(value));
    const servingScore = state.servingTeam === 'A' ? state.scoreA : state.scoreB;
    const otherScore = state.servingTeam === 'A' ? state.scoreB : state.scoreA;
    const base = `${read(servingScore)} ${read(otherScore)} ${read(state.scoreOrder)}`;
    const winner = winnerTeam();
    if (!winner) return base;
    const name = winner === 'A' ? state.teamAName : state.teamBName;
    return `${base}. Chúc mừng ${name || `đội ${winner}`} chiến thắng`;
  }

  function refreshVoices() {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  }

  function speak() {
    const text = scoreText();
    if (!('speechSynthesis' in window)) {
      status('Trình duyệt này không hỗ trợ đọc điểm.', 'text-danger');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    refreshVoices();
    const viVoice = voices.find((voice) => voice.lang && voice.lang.toLowerCase().startsWith('vi'));
    if (viVoice) utterance.voice = viVoice;
    utterance.lang = 'vi-VN';
    utterance.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    status(text);
  }

  function scheduleSpeak() {
    window.clearTimeout(speakTimer);
    speakTimer = window.setTimeout(speak, 120);
  }

  function changeScore(team, delta) {
    if (!canChange(team, delta)) {
      status(team === state.servingTeam ? 'Điểm đã chạm luật hiện tại.' : 'Chỉ đội đang giao được đổi điểm.', 'text-danger');
      return;
    }
    if (team === 'A') state.scoreA += delta;
    if (team === 'B') state.scoreB += delta;
    render();
    scheduleSpeak();
  }

  function changeServing(team) {
    if (team === state.servingTeam) return;
    if (state.scoreOrder !== 2) {
      status('Chỉ đổi đội giao khi đang ở tay 2.', 'text-danger');
      return;
    }
    state.servingTeam = team;
    state.scoreOrder = 1;
    render();
    scheduleSpeak();
  }

  document.querySelectorAll('.score-reader-team[data-reader-team]').forEach((item) => item.addEventListener('click', () => changeServing(item.dataset.readerTeam)));
  document.querySelectorAll('[data-reader-delta]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      changeScore(button.dataset.readerTeam, Number(button.dataset.readerDelta));
    });
  });
  document.querySelectorAll('[data-reader-order]').forEach((button) => {
    button.addEventListener('click', () => {
      state.scoreOrder = Number(button.dataset.readerOrder) === 1 ? 1 : 2;
      render();
      scheduleSpeak();
    });
  });
  refs.teamAName.addEventListener('input', () => {
    state.teamAName = refs.teamAName.value.trim() || 'Đội A';
    render();
  });
  refs.teamBName.addEventListener('input', () => {
    state.teamBName = refs.teamBName.value.trim() || 'Đội B';
    render();
  });
  refs.touchScore.addEventListener('change', () => {
    state.touchScore = number(refs.touchScore.value, 11);
    render();
  });
  refs.maxScore.addEventListener('change', () => {
    state.maxScore = number(refs.maxScore.value, 15);
    render();
  });
  byId('readerSpeakScore')?.addEventListener('click', speak);
  byId('readerResetScore')?.addEventListener('click', () => {
    state = { ...state, scoreA: 0, scoreB: 0, servingTeam: 'A', scoreOrder: 2 };
    render();
    scheduleSpeak();
  });

  if ('speechSynthesis' in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
  render();
})();
