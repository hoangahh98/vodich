(() => {
  const { clearActionLoading, getTournamentSocket, setActionLoading, socketEvents = {} } = window.Vodich || {};
  const rules = window.VodichScoreRules || {};
  const speech = window.VodichScoreSpeech || {};
  const dom = window.VodichScoreboardDom || {};
  const list = document.getElementById('matchList');
  if (!list || typeof getTournamentSocket !== 'function') return;

  const tournamentId = list.dataset.tournamentId;
  const socket = getTournamentSocket(tournamentId);
  if (!socket) return;

  const config = {
    group: {
      touchScore: Number.parseInt(list.dataset.touchScore || '11', 10) || 11,
      maxScore: Number.parseInt(list.dataset.maxScore || '15', 10) || 15,
    },
    knockout: {
      touchScore: Number.parseInt(list.dataset.knockoutTouchScore || '15', 10) || 15,
      maxScore: Number.parseInt(list.dataset.knockoutMaxScore || '19', 10) || 19,
    },
  };

  const modal = document.getElementById('scoreModal');
  const setupStep = document.getElementById('scoreSetupStep');
  const playStep = document.getElementById('scorePlayStep');
  const setupContinue = document.getElementById('scoreSetupContinue');
  const backToSetup = document.getElementById('scoreBackToSetup');
  const scoreTeamA = document.getElementById('scoreTeamA');
  const scoreTeamB = document.getElementById('scoreTeamB');
  const scoreValueA = document.getElementById('scoreInputA');
  const scoreValueB = document.getElementById('scoreInputB');
  const scoreSideA = document.getElementById('scoreSideA');
  const scoreSideB = document.getElementById('scoreSideB');
  const saveStatus = document.getElementById('scoreSaveStatus');
  const playerRefs = {
    A: {
      title: document.getElementById('matchTeamAPlayerTitle'),
      first: document.getElementById('matchAPlayer1'),
      second: document.getElementById('matchAPlayer2'),
    },
    B: {
      title: document.getElementById('matchTeamBPlayerTitle'),
      first: document.getElementById('matchBPlayer1'),
      second: document.getElementById('matchBPlayer2'),
    },
  };
  const courtSlots = {
    A1: document.querySelector('[data-match-court-slot="A1"]'),
    A2: document.querySelector('[data-match-court-slot="A2"]'),
    B1: document.querySelector('[data-match-court-slot="B1"]'),
    B2: document.querySelector('[data-match-court-slot="B2"]'),
  };

  let activeRow = null;
  let state = { scoreA: 0, scoreB: 0, servingTeam: 'A', servingPlayer: '1', firstServerActive: true, scoreHistory: [], scoreOrder: 2, positions: { A: { 1: '1', 2: '2' }, B: { 1: '1', 2: '2' } } };
  let lastWinnerKey = '';
  let saveTimer = null;
  let speakTimer = null;

  const canEditSetup = () => state.scoreA === 0 && state.scoreB === 0;
  const isInitialServeState = () => state.scoreA === 0 && state.scoreB === 0 && !(state.scoreHistory || []).length;

  const updateSetupButton = () => {
    if (!backToSetup) return;
    const setupVisible = setupStep && !setupStep.classList.contains('hidden');
    backToSetup.classList.toggle('hidden', !canEditSetup() || setupVisible);
    backToSetup.disabled = !canEditSetup();
  };

  const showSetupStep = () => {
    if (!canEditSetup()) {
      showPlayStep();
      setStatus('Chỉ đổi tay khi điểm đang là 0-0.', 'text-danger');
      return;
    }
    setupStep?.classList.remove('hidden');
    playStep?.classList.add('hidden');
    updateSetupButton();
  };

  const showPlayStep = () => {
    setupStep?.classList.add('hidden');
    playStep?.classList.remove('hidden');
    updateSetupButton();
  };

  const activeRules = () => (activeRow?.dataset.knockout === 'true' ? config.knockout : config.group);

  const setStatus = (text, className = 'muted') => {
    if (!saveStatus) return;
    saveStatus.className = `score-save-status ${className}`;
    saveStatus.textContent = text;
  };

  const renderModal = () => {
    if (!scoreValueA || !scoreValueB) return;
    scoreValueA.textContent = String(state.scoreA);
    scoreValueB.textContent = String(state.scoreB);
    scoreSideA?.classList.toggle('serving-team', state.servingTeam === 'A');
    scoreSideB?.classList.toggle('serving-team', state.servingTeam === 'B');
    dom.bindOptionState?.(state);
    renderCourt();
    if (!canEditSetup() && setupStep && !setupStep.classList.contains('hidden')) showPlayStep();
    updateSetupButton();
  };

  const setupKey = () => activeRow ? `vodichMatchScoreSetup:${tournamentId}:${activeRow.dataset.matchId}` : '';

  const teamNames = (teamText) => {
    const names = String(teamText || '').split(/\s*\/\s*/).map((name) => name.trim()).filter(Boolean);
    if (names.length >= 2) return names.slice(0, 2);
    return [names[0] || 'Người chơi 1', 'Người chơi 2'];
  };

  const defaultSetup = (row) => ({
    players: { A: teamNames(row.dataset.teamA), B: teamNames(row.dataset.teamB) },
    positions: { A: { 1: '1', 2: '2' }, B: { 1: '1', 2: '2' } },
  });

  const loadSetup = (row) => {
    try {
      return { ...defaultSetup(row), ...JSON.parse(window.localStorage.getItem(`vodichMatchScoreSetup:${tournamentId}:${row.dataset.matchId}`) || '{}') };
    } catch (_) {
      return defaultSetup(row);
    }
  };

  const saveSetup = () => {
    const key = setupKey();
    if (!key) return;
    window.localStorage.setItem(key, JSON.stringify({ players: state.players, positions: state.positions }));
  };

  const playerName = (team, playerNumber) => state.players?.[team]?.[Number(playerNumber) - 1] || `Tay ${playerNumber}`;
  const playerAtSlot = (team, slot) => state.positions?.[team]?.[slot] || '1';
  const otherPlayer = (playerNumber) => String(playerNumber) === '1' ? '2' : '1';

  const renderCourt = () => {
    ['A', 'B'].forEach((team) => {
      [1, 2].forEach((slot) => {
        const marker = courtSlots[`${team}${slot}`];
        if (!marker) return;
        const playerNumber = playerAtSlot(team, slot);
        marker.textContent = playerName(team, playerNumber);
        marker.classList.toggle('serving', state.servingTeam === team && String(state.servingPlayer) === playerNumber);
      });
    });
  };

  const fillSelect = (select, names, value) => {
    if (!select) return;
    select.innerHTML = '';
    names.forEach((name, index) => {
      const option = document.createElement('option');
      option.value = String(index + 1);
      option.textContent = name;
      option.selected = String(value) === option.value;
      select.appendChild(option);
    });
  };

  const renderPlayerSettings = () => {
    ['A', 'B'].forEach((team) => {
      const refs = playerRefs[team];
      if (refs.title) refs.title.textContent = team === 'A' ? (activeRow?.dataset.teamA || 'Đội A') : (activeRow?.dataset.teamB || 'Đội B');
      fillSelect(refs.first, state.players[team], playerAtSlot(team, 1));
      fillSelect(refs.second, state.players[team], playerAtSlot(team, 2));
    });
  };

  const normalizePositions = (team) => {
    if (state.positions[team][1] === state.positions[team][2]) {
      state.positions[team][2] = otherPlayer(state.positions[team][1]);
    }
  };

  const snapshot = () => ({
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
  });

  const swapServingSide = (team) => {
    const first = state.positions[team][1];
    state.positions[team][1] = state.positions[team][2];
    state.positions[team][2] = first;
  };

  const optimisticRow = () => {
    if (!activeRow) return;
    dom.applyRow?.(activeRow, {
      scoreA: state.scoreA,
      scoreB: state.scoreB,
      scoreOrder: state.scoreOrder,
      servingTeam: state.servingTeam,
      status: rules.statusFor?.(state.scoreA, state.scoreB, activeRules()) || 'PLAYING',
    });
  };

  const winnerName = () => {
    if (!activeRow || state.scoreA === state.scoreB) return '';
    if ((rules.statusFor?.(state.scoreA, state.scoreB, activeRules()) || 'PLAYING') !== 'FINISHED') return '';
    return speech.teamSpeechName?.(state.scoreA > state.scoreB ? activeRow.dataset.teamA : activeRow.dataset.teamB) || '';
  };

  const speakCurrentScore = () => {
    const read = speech.readVietnameseNumber || ((value) => String(value));
    const scoreText = state.servingTeam === 'B'
      ? `${read(state.scoreB)} ${read(state.scoreA)} ${read(state.scoreOrder)}`
      : `${read(state.scoreA)} ${read(state.scoreB)} ${read(state.scoreOrder)}`;
    const winner = winnerName();
    const winnerKey = activeRow ? `${activeRow.dataset.matchId}:${winner}:${state.scoreA}-${state.scoreB}` : '';
    if (winner && winnerKey !== lastWinnerKey) {
      lastWinnerKey = winnerKey;
      const prefix = winner.includes(' và ') ? 'đội ' : '';
      speech.speak?.(`${scoreText}. Chúc mừng ${prefix}${winner} giành chiến thắng`);
      return;
    }
    speech.speak?.(scoreText);
  };

  const scheduleSpeak = (delay = 220) => {
    window.clearTimeout(speakTimer);
    if (delay <= 0) {
      speakCurrentScore();
      return;
    }
    speakTimer = window.setTimeout(speakCurrentScore, delay);
  };

  const saveScore = () => {
    if (!activeRow) return;
    const payload = {
      tournamentId,
      matchId: activeRow.dataset.matchId,
      scoreA: state.scoreA,
      scoreB: state.scoreB,
      servingTeam: state.servingTeam,
      scoreOrder: state.scoreOrder,
    };
    window.clearTimeout(saveTimer);
    setStatus('Đang tự lưu...', 'text-primary');
    saveTimer = window.setTimeout(() => {
      socket.emit(socketEvents.SCORE || 'score', payload);
      setStatus('Đã gửi điểm', 'text-success');
    }, 350);
  };

  const openModal = (row) => {
    if (!modal || !scoreTeamA || !scoreTeamB) return;
    activeRow = row;
    state = {
      scoreA: Number.parseInt(row.dataset.scoreA || '0', 10) || 0,
      scoreB: Number.parseInt(row.dataset.scoreB || '0', 10) || 0,
      scoreOrder: Number.parseInt(row.dataset.scoreOrder || '2', 10) === 1 ? 1 : 2,
      servingTeam: row.dataset.servingTeam === 'B' ? 'B' : 'A',
      servingPlayer: '1',
      firstServerActive: (Number.parseInt(row.dataset.scoreA || '0', 10) || 0) === 0 && (Number.parseInt(row.dataset.scoreB || '0', 10) || 0) === 0 && (Number.parseInt(row.dataset.scoreOrder || '2', 10) !== 1),
      scoreHistory: [],
      ...loadSetup(row),
    };
    if (state.firstServerActive) {
      state.servingPlayer = playerAtSlot(state.servingTeam, 1);
    } else {
      state.servingPlayer = playerAtSlot(state.servingTeam, state.scoreOrder);
    }
    scoreTeamA.textContent = dom.formatTeam?.(row.dataset.teamA) || row.dataset.teamA;
    scoreTeamB.textContent = dom.formatTeam?.(row.dataset.teamB) || row.dataset.teamB;
    setStatus('Chưa thay đổi');
    renderPlayerSettings();
    renderModal();
    if (canEditSetup()) showSetupStep();
    else showPlayStep();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  };

  const closeModal = () => {
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    if (typeof clearActionLoading === 'function') document.querySelectorAll('[data-score-close].loading').forEach(clearActionLoading);
    activeRow = null;
  };

  const stepScore = (side, delta) => {
    if (!activeRow) return;
    if (side !== state.servingTeam) {
      setStatus('Chỉ đội đang giao được ghi điểm. Muốn đổi đội giao phải ở tay 2.', 'text-danger');
      return;
    }
    const next = { ...state };
    if (delta > 0) next.scoreHistory = [...(state.scoreHistory || []), snapshot()].slice(-30);
    if (delta < 0) {
      const last = state.scoreHistory?.[state.scoreHistory.length - 1];
      if (last) {
        state.scoreHistory.pop();
        state = { ...state, ...last };
        optimisticRow();
        renderPlayerSettings();
        renderModal();
        scheduleSpeak(0);
        saveSetup();
        saveScore();
        return;
      }
    }
    if (side === 'A') next.scoreA = Math.max(0, next.scoreA + delta);
    if (side === 'B') next.scoreB = Math.max(0, next.scoreB + delta);
    [next.scoreA, next.scoreB] = rules.clampScores?.(next.scoreA, next.scoreB, activeRules()) || [next.scoreA, next.scoreB];
    state = next;
    if (delta > 0) swapServingSide(side);
    optimisticRow();
    renderPlayerSettings();
    renderModal();
    scheduleSpeak(0);
    saveSetup();
    saveScore();
  };

  socket.on(socketEvents.SCORE_UPDATED || 'scoreUpdated', (match) => {
    const row = list.querySelector(`[data-match-id="${match.id}"]`);
    if (!row) return;
    dom.applyRow?.(row, match);
    if (activeRow === row) {
      state = {
        scoreA: Number(match.scoreA) || 0,
        scoreB: Number(match.scoreB) || 0,
        scoreOrder: Number(match.scoreOrder) === 1 ? 1 : 2,
        servingTeam: match.servingTeam === 'B' ? 'B' : 'A',
        servingPlayer: state.servingPlayer,
        firstServerActive: state.firstServerActive,
        scoreHistory: state.scoreHistory || [],
        players: state.players,
        positions: state.positions,
      };
      renderModal();
      setStatus('Đã tự lưu', 'text-success');
    }
  });

  socket.on(socketEvents.SCORE_REJECTED || 'scoreRejected', (payload) => {
    setStatus(payload?.message || 'Không lưu được điểm', 'text-danger');
  });

  list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-match-id]');
    if (row) openModal(row);
  });

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('[data-match-id]');
    if (!row) return;
    event.preventDefault();
    openModal(row);
  });

  document.querySelectorAll('[data-score-close]').forEach((item) => item.addEventListener('click', () => {
    if (item instanceof HTMLButtonElement && typeof setActionLoading === 'function') setActionLoading(item, 'Đang đóng...');
    window.setTimeout(closeModal, 60);
  }));

  document.querySelectorAll('[data-serving-select], [data-serving-side]').forEach((item) => {
    item.addEventListener('click', (event) => {
      const clicked = event.target instanceof Element ? event.target : null;
      if (clicked?.closest('[data-score-target]')) return;
      const side = item.dataset.servingSelect || item.dataset.servingSide;
      if (!side || !activeRow) return;
      const selectingFirstServer = Boolean(setupStep?.contains(item));
      if (side !== state.servingTeam && selectingFirstServer && isInitialServeState()) {
        const nextServingTeam = side === 'B' ? 'B' : 'A';
        state = {
          ...state,
          servingTeam: nextServingTeam,
          scoreOrder: 2,
          servingPlayer: playerAtSlot(nextServingTeam, 1),
          firstServerActive: true,
          scoreHistory: [],
        };
        optimisticRow();
        renderModal();
        scheduleSpeak(0);
        saveScore();
        return;
      }
      if (side !== state.servingTeam && state.scoreOrder !== 2) {
        setStatus('Chỉ đổi đội giao khi đang ở tay 2', 'text-danger');
        scheduleSpeak(0);
        return;
      }
      const changedServingTeam = side !== state.servingTeam;
      state = {
        ...state,
        servingTeam: side === 'B' ? 'B' : 'A',
        scoreOrder: changedServingTeam ? 1 : state.scoreOrder,
        firstServerActive: false,
        scoreHistory: [],
      };
      if (changedServingTeam) state.servingPlayer = playerAtSlot(state.servingTeam, 1);
      optimisticRow();
      renderModal();
      scheduleSpeak(0);
      saveScore();
    });
  });

  document.querySelectorAll('[data-score-order-select]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextOrder = Number(button.dataset.scoreOrderSelect) === 1 ? 1 : 2;
      state = { ...state, scoreOrder: nextOrder, firstServerActive: nextOrder === 1 ? false : state.firstServerActive, scoreHistory: [] };
      if (nextOrder === 2 && isInitialServeState()) {
        state.firstServerActive = true;
        state.servingPlayer = playerAtSlot(state.servingTeam, 1);
      } else {
        state.servingPlayer = nextOrder === 1 ? playerAtSlot(state.servingTeam, 1) : otherPlayer(playerAtSlot(state.servingTeam, 1));
      }
      optimisticRow();
      renderModal();
      scheduleSpeak(0);
      saveScore();
    });
  });

  document.querySelectorAll('[data-score-target]').forEach((button) => {
    button.addEventListener('click', () => {
      stepScore(button.dataset.scoreTarget, Number.parseInt(button.dataset.scoreDelta || '0', 10) || 0);
    });
  });

  setupContinue?.addEventListener('click', () => {
    saveSetup();
    renderModal();
    showPlayStep();
    scheduleSpeak(120);
  });

  backToSetup?.addEventListener('click', () => {
    if (!canEditSetup()) {
      setStatus('Chỉ đổi tay khi điểm đang là 0-0.', 'text-danger');
      return;
    }
    showSetupStep();
  });

  ['A', 'B'].forEach((team) => {
    const refs = playerRefs[team];
    refs.first?.addEventListener('change', () => {
      state.positions[team][1] = refs.first.value;
      normalizePositions(team);
      if (state.servingTeam === team && state.scoreOrder === 1) state.servingPlayer = playerAtSlot(team, 1);
      renderPlayerSettings();
      renderModal();
      saveSetup();
    });
    refs.second?.addEventListener('change', () => {
      state.positions[team][2] = refs.second.value;
      normalizePositions(team);
      if (state.servingTeam === team && state.scoreOrder === 2 && !state.firstServerActive) state.servingPlayer = playerAtSlot(team, 2);
      renderPlayerSettings();
      renderModal();
      saveSetup();
    });
  });
})();
