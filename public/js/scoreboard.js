(() => {
  const { clearActionLoading, getTournamentSocket, setActionLoading, socketEvents = {} } = window.Vodich || {};
  const list = document.getElementById('matchList');
  if (!list || typeof getTournamentSocket !== 'function') return;
  const tournamentId = list.dataset.tournamentId;
  const socket = getTournamentSocket(tournamentId);
  if (!socket) return;
  const groupTouchScore = Number.parseInt(list.dataset.touchScore || '11', 10) || 11;
  const groupMaxScore = Number.parseInt(list.dataset.maxScore || '15', 10) || 15;
  const knockoutTouchScore = Number.parseInt(list.dataset.knockoutTouchScore || '15', 10) || 15;
  const knockoutMaxScore = Number.parseInt(list.dataset.knockoutMaxScore || '19', 10) || 19;
  const modal = document.getElementById('scoreModal');
  const scoreTeamA = document.getElementById('scoreTeamA');
  const scoreTeamB = document.getElementById('scoreTeamB');
  const scoreValueA = document.getElementById('scoreInputA');
  const scoreValueB = document.getElementById('scoreInputB');
  const scoreSideA = document.getElementById('scoreSideA');
  const scoreSideB = document.getElementById('scoreSideB');
  const saveStatus = document.getElementById('scoreSaveStatus');
  let activeRow = null;
  let scoreA = 0;
  let scoreB = 0;
  let servingTeam = 'A';
  let scoreOrder = 2;
  let saveTimer = null;
  const activeRules = () => (activeRow?.dataset.knockout === 'true'
    ? { touchScore: knockoutTouchScore, maxScore: knockoutMaxScore }
    : { touchScore: groupTouchScore, maxScore: groupMaxScore });
  const maxAllowedScore = (opponentScore) => {
    const { touchScore, maxScore } = activeRules();
    if (opponentScore >= touchScore - 1) return Math.min(opponentScore + 2, maxScore);
    return Math.min(touchScore, maxScore);
  };
  const clampScores = (a, b) => {
    let nextA = Math.min(Math.max(0, a), maxAllowedScore(b));
    let nextB = Math.min(Math.max(0, b), maxAllowedScore(nextA));
    nextA = Math.min(nextA, maxAllowedScore(nextB));
    return [nextA, nextB];
  };
  const formatTeam = (name) => String(name || '').split(' / ').join('\n');
  let lastWinnerKey = '';
  let speakTimer = null;
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
  const winnerName = () => {
    if (!activeRow || scoreA === scoreB) return '';
    const { touchScore, maxScore } = activeRules();
    const high = Math.max(scoreA, scoreB);
    const diff = Math.abs(scoreA - scoreB);
    if (!(high >= maxScore || (high >= touchScore && diff >= 2))) return '';
    return teamSpeechName(scoreA > scoreB ? activeRow.dataset.teamA : activeRow.dataset.teamB);
  };
  const speak = (text) => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };
  const speakCurrentScore = () => {
    const scoreText = servingTeam === 'B'
      ? `${readVietnameseNumber(scoreB)} ${readVietnameseNumber(scoreA)} ${readVietnameseNumber(scoreOrder)}`
      : `${readVietnameseNumber(scoreA)} ${readVietnameseNumber(scoreB)} ${readVietnameseNumber(scoreOrder)}`;
    const winner = winnerName();
    const winnerKey = activeRow ? `${activeRow.dataset.matchId}:${winner}:${scoreA}-${scoreB}` : '';
    if (winner && winnerKey !== lastWinnerKey) {
      lastWinnerKey = winnerKey;
      const prefix = winner.includes(' và ') ? 'đội ' : '';
      speak(`${scoreText}. Chúc mừng ${prefix}${winner} giành chiến thắng`);
      return;
    }
    speak(scoreText);
  };
  const scheduleSpeak = (delay = 220) => {
    window.clearTimeout(speakTimer);
    if (delay <= 0) {
      speakCurrentScore();
      return;
    }
    speakTimer = window.setTimeout(speakCurrentScore, delay);
  };
  const setStatus = (text, className = 'muted') => {
    if (!saveStatus) return;
    saveStatus.className = `score-save-status ${className}`;
    saveStatus.textContent = text;
  };
  const renderModal = () => {
    if (!scoreValueA || !scoreValueB) return;
    scoreValueA.textContent = String(scoreA);
    scoreValueB.textContent = String(scoreB);
    scoreSideA?.classList.toggle('serving-team', servingTeam === 'A');
    scoreSideB?.classList.toggle('serving-team', servingTeam === 'B');
    document.querySelectorAll('[data-score-target]').forEach((button) => { button.disabled = false; });
    document.querySelectorAll('[data-serving-select]').forEach((button) => {
      button.classList.toggle('btn-primary', button.dataset.servingSelect === servingTeam);
    });
    document.querySelectorAll('[data-score-order-select]').forEach((button) => {
      button.classList.toggle('btn-primary', Number(button.dataset.scoreOrderSelect) === scoreOrder);
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
    const scorePill = row.querySelector('.score-pill');
    scorePill?.classList.toggle('bg-success', match.status === 'FINISHED');
    scorePill?.classList.toggle('bg-primary', match.status !== 'FINISHED');
    const order = row.querySelector('.score-order');
    if (order) order.textContent = match.scoreOrder || 2;
    const status = match.status === 'FINISHED' ? 'Đã xong' : match.status === 'PLAYING' ? 'Đang đánh' : 'Chưa đánh';
    const statusEl = row.querySelector('.match-status');
    statusEl.textContent = status;
    statusEl.classList.toggle('bg-success', match.status === 'FINISHED');
    statusEl.classList.toggle('bg-secondary', match.status !== 'FINISHED');
    row.classList.toggle('da-xong', match.status === 'FINISHED');
    updateRoundDoneCount(row);
  };
  const optimisticRow = () => {
    if (!activeRow) return;
    const { touchScore, maxScore } = activeRules();
    const high = Math.max(scoreA, scoreB);
    const diff = Math.abs(scoreA - scoreB);
    const status = high >= maxScore || (high >= touchScore && diff >= 2 && scoreA !== scoreB) ? 'FINISHED' : 'PLAYING';
    applyRow(activeRow, { scoreA, scoreB, scoreOrder, servingTeam, status });
  };
  const saveScore = () => {
    if (!activeRow) return;
    const matchId = activeRow.dataset.matchId;
    const payload = { tournamentId, matchId, scoreA, scoreB, servingTeam, scoreOrder };
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
    scoreA = Number.parseInt(row.dataset.scoreA || '0', 10) || 0;
    scoreB = Number.parseInt(row.dataset.scoreB || '0', 10) || 0;
    scoreOrder = Number.parseInt(row.dataset.scoreOrder || '2', 10) === 1 ? 1 : 2;
    servingTeam = row.dataset.servingTeam === 'B' ? 'B' : 'A';
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
    if (side !== servingTeam) {
      setStatus('Chỉ đội đang giao được ghi điểm. Muốn đổi đội giao phải ở tay 2.', 'text-danger');
      return;
    }
    if (side === 'A') scoreA = Math.max(0, scoreA + delta);
    if (side === 'B') scoreB = Math.max(0, scoreB + delta);
    [scoreA, scoreB] = clampScores(scoreA, scoreB);
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
      scoreA = Number(match.scoreA) || 0;
      scoreB = Number(match.scoreB) || 0;
      scoreOrder = Number(match.scoreOrder) === 1 ? 1 : 2;
      servingTeam = match.servingTeam === 'B' ? 'B' : 'A';
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
      if (side !== servingTeam && scoreOrder !== 2) {
        setStatus('Chỉ đổi đội giao khi đang ở tay 2', 'text-danger');
        scheduleSpeak(0);
        return;
      }
      servingTeam = side === 'B' ? 'B' : 'A';
      if (activeRow.dataset.servingTeam !== servingTeam) scoreOrder = 1;
      optimisticRow();
      renderModal();
      scheduleSpeak(0);
      saveScore();
    });
  });
  document.querySelectorAll('[data-score-order-select]').forEach((button) => {
    button.addEventListener('click', () => {
      scoreOrder = Number(button.dataset.scoreOrderSelect) === 1 ? 1 : 2;
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
