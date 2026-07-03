(() => {
  const { clearActionLoading, getTournamentSocket, setActionLoading, socketEvents = {} } = window.Vodich || {};
  const rules = window.VodichScoreRules || {};
  const speech = window.VodichScoreSpeech || {};
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
  const scoreTeamA = document.getElementById('scoreTeamA');
  const scoreTeamB = document.getElementById('scoreTeamB');
  const scoreValueA = document.getElementById('scoreInputA');
  const scoreValueB = document.getElementById('scoreInputB');
  const scoreSideA = document.getElementById('scoreSideA');
  const scoreSideB = document.getElementById('scoreSideB');
  const saveStatus = document.getElementById('scoreSaveStatus');

  let activeRow = null;
  let state = { scoreA: 0, scoreB: 0, servingTeam: 'A', scoreOrder: 2 };
  let lastWinnerKey = '';
  let saveTimer = null;
  let speakTimer = null;

  const activeRules = () => (activeRow?.dataset.knockout === 'true' ? config.knockout : config.group);
  const formatTeam = (name) => String(name || '').split(' / ').join('\n');

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
    document.querySelectorAll('[data-score-target]').forEach((button) => { button.disabled = false; });
    document.querySelectorAll('[data-serving-select]').forEach((button) => {
      button.classList.toggle('btn-primary', button.dataset.servingSelect === state.servingTeam);
    });
    document.querySelectorAll('[data-score-order-select]').forEach((button) => {
      button.classList.toggle('btn-primary', Number(button.dataset.scoreOrderSelect) === state.scoreOrder);
    });
  };

  const updateRoundDoneCount = (row) => {
    const roundBlock = row.closest('[data-round-block]');
    const doneCountEl = roundBlock?.querySelector('[data-done-count]');
    if (!roundBlock || !doneCountEl) return;
    doneCountEl.textContent = String(roundBlock.querySelectorAll('.tran-card.da-xong').length);
  };

  const applyRow = (row, match) => {
    row.dataset.scoreA = String(match.scoreA);
    row.dataset.scoreB = String(match.scoreB);
    row.dataset.scoreOrder = String(match.scoreOrder || 2);
    row.dataset.servingTeam = match.servingTeam || 'A';
    row.querySelector('.score-a').textContent = match.scoreA;
    row.querySelector('.score-b').textContent = match.scoreB;
    row.querySelector('.score-order').textContent = match.scoreOrder || 2;

    const finished = match.status === 'FINISHED';
    const scorePill = row.querySelector('.score-pill');
    scorePill?.classList.toggle('bg-success', finished);
    scorePill?.classList.toggle('bg-primary', !finished);

    const statusEl = row.querySelector('.match-status');
    statusEl.textContent = finished ? 'Đã xong' : match.status === 'PLAYING' ? 'Đang đánh' : 'Chưa đánh';
    statusEl.classList.toggle('bg-success', finished);
    statusEl.classList.toggle('bg-secondary', !finished);

    row.classList.toggle('da-xong', finished);
    updateRoundDoneCount(row);
  };

  const optimisticRow = () => {
    if (!activeRow) return;
    applyRow(activeRow, {
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
    const payload = { tournamentId, matchId: activeRow.dataset.matchId, ...state };
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
    };
    scoreTeamA.textContent = formatTeam(row.dataset.teamA);
    scoreTeamB.textContent = formatTeam(row.dataset.teamB);
    setStatus('Chưa thay đổi');
    renderModal();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    scheduleSpeak(120);
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
    if (side === 'A') next.scoreA = Math.max(0, next.scoreA + delta);
    if (side === 'B') next.scoreB = Math.max(0, next.scoreB + delta);
    [next.scoreA, next.scoreB] = rules.clampScores?.(next.scoreA, next.scoreB, activeRules()) || [next.scoreA, next.scoreB];
    state = next;
    optimisticRow();
    renderModal();
    scheduleSpeak(0);
    saveScore();
  };

  socket.on(socketEvents.SCORE_UPDATED || 'scoreUpdated', (match) => {
    const row = list.querySelector(`[data-match-id="${match.id}"]`);
    if (!row) return;
    applyRow(row, match);
    if (activeRow === row) {
      state = {
        scoreA: Number(match.scoreA) || 0,
        scoreB: Number(match.scoreB) || 0,
        scoreOrder: Number(match.scoreOrder) === 1 ? 1 : 2,
        servingTeam: match.servingTeam === 'B' ? 'B' : 'A',
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
      if (side !== state.servingTeam && state.scoreOrder !== 2) {
        setStatus('Chỉ đổi đội giao khi đang ở tay 2', 'text-danger');
        scheduleSpeak(0);
        return;
      }
      state = {
        ...state,
        servingTeam: side === 'B' ? 'B' : 'A',
        scoreOrder: activeRow.dataset.servingTeam !== side ? 1 : state.scoreOrder,
      };
      optimisticRow();
      renderModal();
      scheduleSpeak(0);
      saveScore();
    });
  });

  document.querySelectorAll('[data-score-order-select]').forEach((button) => {
    button.addEventListener('click', () => {
      state = { ...state, scoreOrder: Number(button.dataset.scoreOrderSelect) === 1 ? 1 : 2 };
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
})();
