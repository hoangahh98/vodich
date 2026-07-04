(() => {
  const root = document.querySelector('[data-score-reader]');
  if (!root) return;

  const cacheKey = 'vodichFriendlyScoreReader';
  const defaults = {
    teamAName: 'Đội A',
    teamBName: 'Đội B',
    aPlayer1Name: 'A người 1',
    aPlayer2Name: 'A người 2',
    bPlayer1Name: 'B người 1',
    bPlayer2Name: 'B người 2',
    positions: {
      A: { 1: '1', 2: '2' },
      B: { 1: '1', 2: '2' },
    },
    scoreA: 0,
    scoreB: 0,
    servingTeam: 'A',
    servingPlayer: '1',
    firstServerActive: true,
    scoreHistory: [],
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
    aPlayer1Name: byId('readerAPlayer1Name'),
    aPlayer2Name: byId('readerAPlayer2Name'),
    bPlayer1Name: byId('readerBPlayer1Name'),
    bPlayer2Name: byId('readerBPlayer2Name'),
    teamALabel: byId('readerTeamALabel'),
    teamBLabel: byId('readerTeamBLabel'),
    teamACard: byId('readerTeamACard'),
    teamBCard: byId('readerTeamBCard'),
    scoreA: byId('readerScoreA'),
    scoreB: byId('readerScoreB'),
    touchScore: byId('readerTouchScore'),
    maxScore: byId('readerMaxScore'),
    status: byId('readerStatus'),
    courtSlots: {
      A1: document.querySelector('[data-court-slot="A1"]'),
      A2: document.querySelector('[data-court-slot="A2"]'),
      B1: document.querySelector('[data-court-slot="B1"]'),
      B2: document.querySelector('[data-court-slot="B2"]'),
    },
  };

  function loadState() {
    try {
      return { ...defaults, ...JSON.parse(window.sessionStorage.getItem(cacheKey) || '{}') };
    } catch (_) {
      return { ...defaults };
    }
  }

  function saveState() {
    window.sessionStorage.setItem(cacheKey, JSON.stringify(state));
  }

  function number(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp() {
    state.positions = state.positions || { A: { 1: '1', 2: '2' }, B: { 1: '1', 2: '2' } };
    state.positions.A = state.positions.A || { 1: '1', 2: '2' };
    state.positions.B = state.positions.B || { 1: '1', 2: '2' };
    state.positions.A[1] = state.positions.A[1] === '2' ? '2' : '1';
    state.positions.A[2] = state.positions.A[2] === '1' ? '1' : '2';
    state.positions.B[1] = state.positions.B[1] === '2' ? '2' : '1';
    state.positions.B[2] = state.positions.B[2] === '1' ? '1' : '2';
    if (state.positions.A[1] === state.positions.A[2]) state.positions.A[2] = state.positions.A[1] === '1' ? '2' : '1';
    if (state.positions.B[1] === state.positions.B[2]) state.positions.B[2] = state.positions.B[1] === '1' ? '2' : '1';
    state.touchScore = Math.max(1, number(state.touchScore, 11));
    state.maxScore = Math.max(state.touchScore, number(state.maxScore, 15));
    state.scoreA = Math.min(Math.max(0, number(state.scoreA, 0)), state.maxScore);
    state.scoreB = Math.min(Math.max(0, number(state.scoreB, 0)), state.maxScore);
    state.scoreOrder = state.scoreOrder === 1 ? 1 : 2;
    state.servingTeam = state.servingTeam === 'B' ? 'B' : 'A';
    state.firstServerActive = state.firstServerActive === false ? false : state.servingTeam === 'A' && state.scoreOrder === 2;
    state.servingPlayer = state.servingPlayer === '2' ? '2' : '1';
    if (state.firstServerActive) state.servingPlayer = '1';
    state.scoreHistory = Array.isArray(state.scoreHistory) ? state.scoreHistory.slice(-30) : [];
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
    if (document.activeElement !== refs.teamAName) refs.teamAName.value = state.teamAName;
    if (document.activeElement !== refs.teamBName) refs.teamBName.value = state.teamBName;
    if (document.activeElement !== refs.aPlayer1Name) refs.aPlayer1Name.value = state.aPlayer1Name;
    if (document.activeElement !== refs.aPlayer2Name) refs.aPlayer2Name.value = state.aPlayer2Name;
    if (document.activeElement !== refs.bPlayer1Name) refs.bPlayer1Name.value = state.bPlayer1Name;
    if (document.activeElement !== refs.bPlayer2Name) refs.bPlayer2Name.value = state.bPlayer2Name;
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
    renderCourt();
    saveState();
  }

  function playerName(team, playerNumber) {
    const key = `${team.toLowerCase()}Player${playerNumber}Name`;
    return state[key] || `${team} người ${playerNumber}`;
  }

  function renderCourt() {
    ['A', 'B'].forEach((team) => {
      [1, 2].forEach((slot) => {
        const marker = refs.courtSlots[`${team}${slot}`];
        if (!marker) return;
        const playerNumber = state.positions[team][slot];
        marker.textContent = playerName(team, playerNumber);
        marker.classList.toggle('serving', state.servingTeam === team && String(state.servingPlayer) === playerNumber);
      });
    });
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
    if (delta > 0) {
      winRally(team);
      return;
    }
    rollbackScore(team);
  }

  function swapServingSide(team) {
    const first = state.positions[team][1];
    state.positions[team][1] = state.positions[team][2];
    state.positions[team][2] = first;
  }

  function winRally(team = state.servingTeam) {
    if (!canChange(team, 1)) {
      status(team === state.servingTeam ? 'Điểm đã chạm luật hiện tại.' : 'Chỉ đội đang giao được ăn điểm.', 'text-danger');
      return;
    }
    state.scoreHistory.push(snapshot());
    if (team === 'A') state.scoreA += 1;
    if (team === 'B') state.scoreB += 1;
    swapServingSide(team);
    render();
    scheduleSpeak();
  }

  function snapshot() {
    return {
      scoreA: state.scoreA,
      scoreB: state.scoreB,
      servingTeam: state.servingTeam,
      servingPlayer: state.servingPlayer,
      firstServerActive: state.firstServerActive,
      scoreOrder: state.scoreOrder,
      positions: {
        A: { 1: state.positions.A[1], 2: state.positions.A[2] },
        B: { 1: state.positions.B[1], 2: state.positions.B[2] },
      },
    };
  }

  function rollbackScore(team) {
    const last = state.scoreHistory[state.scoreHistory.length - 1];
    if (last && state.servingTeam === team) {
      state.scoreHistory.pop();
      state = { ...state, ...last };
      render();
      scheduleSpeak();
      return;
    }
    if (team === 'A') state.scoreA -= 1;
    if (team === 'B') state.scoreB -= 1;
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
    state.servingPlayer = '1';
    state.firstServerActive = false;
    state.scoreHistory = [];
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
      state.servingPlayer = String(state.scoreOrder);
      if (state.scoreOrder === 1) state.firstServerActive = false;
      state.scoreHistory = [];
      render();
      scheduleSpeak();
    });
  });
  bindNameInput(refs.teamAName, 'teamAName', 'Đội A', () => { refs.teamALabel.textContent = state.teamAName; });
  bindNameInput(refs.teamBName, 'teamBName', 'Đội B', () => { refs.teamBLabel.textContent = state.teamBName; });
  bindNameInput(refs.aPlayer1Name, 'aPlayer1Name', 'A người 1', renderCourt);
  bindNameInput(refs.aPlayer2Name, 'aPlayer2Name', 'A người 2', renderCourt);
  bindNameInput(refs.bPlayer1Name, 'bPlayer1Name', 'B người 1', renderCourt);
  bindNameInput(refs.bPlayer2Name, 'bPlayer2Name', 'B người 2', renderCourt);

  function bindNameInput(input, key, fallback, afterInput) {
    input.addEventListener('input', () => {
      state[key] = input.value || fallback;
      afterInput?.();
      saveState();
    });
    input.addEventListener('blur', render);
  }
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
    state = { ...state, scoreA: 0, scoreB: 0, servingTeam: 'A', servingPlayer: '1', firstServerActive: true, scoreHistory: [], scoreOrder: 2, positions: { A: { 1: '1', 2: '2' }, B: { 1: '1', 2: '2' } } };
    render();
    scheduleSpeak();
  });

  if ('speechSynthesis' in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
  render();
})();
