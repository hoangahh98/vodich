(() => {
  const formatTeam = (name) => String(name || '').split(' / ').join('\n');

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

  const bindOptionState = (state) => {
    document.querySelectorAll('[data-score-target]').forEach((button) => {
      button.disabled = false;
    });
    document.querySelectorAll('[data-serving-select]').forEach((button) => {
      button.classList.toggle('btn-primary', button.dataset.servingSelect === state.servingTeam);
    });
    document.querySelectorAll('[data-score-order-select]').forEach((button) => {
      button.classList.toggle('btn-primary', Number(button.dataset.scoreOrderSelect) === state.scoreOrder);
    });
  };

  window.VodichScoreboardDom = {
    applyRow,
    bindOptionState,
    formatTeam,
  };
})();
