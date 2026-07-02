document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const requiredCheckedName = form.dataset.requireChecked;
  if (requiredCheckedName && !form.querySelector(`input[name="${requiredCheckedName}"]:checked`)) {
    event.preventDefault();
    alert('Chưa chọn thành viên nào.');
    return;
  }
  const confirmMessage = form.dataset.confirm;
  if (confirmMessage && !window.confirm(confirmMessage)) {
    event.preventDefault();
    return;
  }
  const button = form.querySelector('button[type="submit"], button:not([type])');
  if (!button) return;
  button.dataset.originalText = button.textContent || '';
  button.textContent = button.getAttribute('data-loading-text') || 'Đang xử lý...';
  button.classList.add('loading');
});

document.addEventListener('input', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.classList.contains('money-input')) return;
  const digits = input.value.replace(/[^\d]/g, '');
  input.value = digits ? Number(digits).toLocaleString('en-US') : '';
});

(() => {
  const formatSelect = document.querySelector('select[name="format"]');
  const formatRadios = [...document.querySelectorAll('input[name="format"]')];
  const qualifierField = document.getElementById('knockoutQualifierField');
  const qualifierInput = document.getElementById('knockoutQualifierCount');
  const finalBox = document.getElementById('knockoutFinal');
  const semiBox = document.getElementById('knockoutSemi');
  const quarterBox = document.getElementById('knockoutQuarter');
  if ((!formatSelect && !formatRadios.length) || !qualifierField) return;
  const currentFormat = () => formatSelect?.value || formatRadios.find((radio) => radio.checked)?.value;
  const syncKnockout = () => {
    if (!qualifierInput || !finalBox || !semiBox || !quarterBox) return;
    if (quarterBox.checked) {
      semiBox.checked = true;
      finalBox.checked = true;
      qualifierInput.value = '8';
      return;
    }
    if (semiBox.checked) {
      finalBox.checked = true;
      qualifierInput.value = '4';
      return;
    }
    finalBox.checked = true;
    qualifierInput.value = '2';
  };
  const sync = () => {
    qualifierField.classList.toggle('hidden', currentFormat() !== 'GROUP_KNOCKOUT');
    syncKnockout();
  };
  formatSelect?.addEventListener('change', sync);
  formatRadios.forEach((radio) => radio.addEventListener('change', sync));
  [finalBox, semiBox, quarterBox].forEach((box) => box?.addEventListener('change', syncKnockout));
  sync();
})();

(() => {
  document.querySelectorAll('[data-check-all]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      document.querySelectorAll(checkbox.dataset.checkAll).forEach((item) => {
        if (item instanceof HTMLInputElement) item.checked = checkbox.checked;
      });
    });
  });
})();

(() => {
  const hint = document.getElementById('playerSlotHint');
  const picker = document.querySelector('[data-player-picker]');
  if (!hint || !picker) return;
  const totalSlots = Number.parseInt(hint.dataset.slotsLeft || '0', 10) || 0;
  const slotCount = hint.querySelector('[data-slot-count]');
  const selectedCount = hint.querySelector('[data-selected-count]');
  const sync = () => {
    const selected = picker.querySelectorAll('input[type="checkbox"]:checked').length;
    const officialLeft = Math.max(0, totalSlots - selected);
    if (slotCount) slotCount.textContent = String(officialLeft);
    if (selectedCount) selectedCount.textContent = String(selected);
    hint.classList.toggle('warn', officialLeft === 0);
    hint.classList.toggle('info', officialLeft > 0);
  };
  picker.addEventListener('change', sync);
  sync();
})();

(() => {
  const list = document.getElementById('matchList');
  if (!list || typeof io === 'undefined') return;
  const socket = io();
  const tournamentId = list.dataset.tournamentId;
  const touchScore = Number.parseInt(list.dataset.touchScore || '11', 10) || 11;
  const maxScore = Number.parseInt(list.dataset.maxScore || '15', 10) || 15;
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
  const maxAllowedScore = (opponentScore) => {
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
    document.querySelectorAll('[data-score-target]').forEach((button) => {
      button.disabled = button.dataset.scoreTarget !== servingTeam;
    });
    document.querySelectorAll('[data-serving-select]').forEach((button) => {
      button.classList.toggle('btn-primary', button.dataset.servingSelect === servingTeam);
    });
    document.querySelectorAll('[data-score-order-select]').forEach((button) => {
      button.classList.toggle('btn-primary', Number(button.dataset.scoreOrderSelect) === scoreOrder);
    });
  };
  const applyRow = (row, match) => {
    row.dataset.scoreA = String(match.scoreA);
    row.dataset.scoreB = String(match.scoreB);
    row.dataset.scoreOrder = String(match.scoreOrder || 2);
    row.dataset.servingTeam = match.servingTeam || 'A';
    row.querySelector('.score-a').textContent = match.scoreA;
    row.querySelector('.score-b').textContent = match.scoreB;
    const order = row.querySelector('.score-order');
    if (order) order.textContent = match.scoreOrder || 2;
    const status = match.status === 'FINISHED' ? 'Đã xong' : match.status === 'PLAYING' ? 'Đang đánh' : 'Chưa đánh';
    row.querySelector('.match-status').textContent = status;
    row.classList.toggle('da-xong', match.status === 'FINISHED');
  };
  const optimisticRow = () => {
    if (!activeRow) return;
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
      socket.emit('score', payload);
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
  };
  const closeModal = () => {
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    activeRow = null;
  };
  const stepScore = (side, delta) => {
    if (!activeRow || side !== servingTeam) return;
    if (side === 'A') scoreA = Math.max(0, scoreA + delta);
    if (side === 'B') scoreB = Math.max(0, scoreB + delta);
    [scoreA, scoreB] = clampScores(scoreA, scoreB);
    optimisticRow();
    renderModal();
    saveScore();
  };
  socket.emit('joinTournament', tournamentId);
  socket.on('scoreUpdated', (match) => {
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
  document.querySelectorAll('[data-score-close]').forEach((item) => item.addEventListener('click', closeModal));
  document.querySelectorAll('[data-serving-select], [data-serving-side]').forEach((item) => {
    item.addEventListener('click', () => {
      const side = item.dataset.servingSelect || item.dataset.servingSide;
      if (!side || !activeRow) return;
      if (side !== servingTeam && scoreOrder !== 2) {
        setStatus('Chỉ đổi đội giao khi đang ở tay 2', 'text-danger');
        return;
      }
      servingTeam = side === 'B' ? 'B' : 'A';
      if (activeRow.dataset.servingTeam !== servingTeam) scoreOrder = 1;
      optimisticRow();
      renderModal();
      saveScore();
    });
  });
  document.querySelectorAll('[data-score-order-select]').forEach((button) => {
    button.addEventListener('click', () => {
      scoreOrder = Number(button.dataset.scoreOrderSelect) === 1 ? 1 : 2;
      optimisticRow();
      renderModal();
      saveScore();
    });
  });
  document.querySelectorAll('[data-score-target]').forEach((button) => {
    button.addEventListener('click', () => {
      stepScore(button.dataset.scoreTarget, Number.parseInt(button.dataset.scoreDelta || '0', 10) || 0);
    });
  });
})();
