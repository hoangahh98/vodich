document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
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
  const list = document.getElementById('matchList');
  if (!list || typeof io === 'undefined') return;
  const socket = io();
  const tournamentId = list.dataset.tournamentId;
  const touchScore = Number.parseInt(list.dataset.touchScore || '11', 10) || 11;
  const maxScore = Number.parseInt(list.dataset.maxScore || '15', 10) || 15;
  const maxAllowedScore = (opponentScore) => {
    if (opponentScore >= touchScore - 1) return Math.min(opponentScore + 2, maxScore);
    return Math.min(touchScore, maxScore);
  };
  const clampScores = (scoreA, scoreB) => {
    let nextA = Math.min(Math.max(0, scoreA), maxAllowedScore(scoreB));
    let nextB = Math.min(Math.max(0, scoreB), maxAllowedScore(nextA));
    nextA = Math.min(nextA, maxAllowedScore(nextB));
    return [nextA, nextB];
  };
  socket.emit('joinTournament', tournamentId);
  socket.on('scoreUpdated', (match) => {
    const row = list.querySelector(`[data-match-id="${match.id}"]`);
    if (!row) return;
    row.querySelector('.score-a').textContent = match.scoreA;
    row.querySelector('.score-b').textContent = match.scoreB;
    const order = row.querySelector('.score-order');
    if (order) order.textContent = match.scoreOrder || 2;
    const status = match.status === 'FINISHED' ? 'Đã xong' : match.status === 'PLAYING' ? 'Đang đánh' : 'Chưa đánh';
    row.querySelector('.match-status').textContent = status;
    row.classList.toggle('da-xong', match.status === 'FINISHED');
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-side]');
    if (!button) return;
    const row = button.closest('[data-match-id]');
    const scoreAEl = row.querySelector('.score-a');
    const scoreBEl = row.querySelector('.score-b');
    let scoreA = Number.parseInt(scoreAEl.textContent || '0', 10);
    let scoreB = Number.parseInt(scoreBEl.textContent || '0', 10);
    const delta = Number.parseInt(button.dataset.delta || '0', 10);
    if (button.dataset.side === 'A') scoreA = Math.max(0, scoreA + delta);
    if (button.dataset.side === 'B') scoreB = Math.max(0, scoreB + delta);
    [scoreA, scoreB] = clampScores(scoreA, scoreB);
    scoreAEl.textContent = String(scoreA);
    scoreBEl.textContent = String(scoreB);
    button.classList.add('loading');
    setTimeout(() => button.classList.remove('loading'), 250);
    socket.emit('score', { tournamentId, matchId: row.dataset.matchId, scoreA, scoreB, servingTeam: button.dataset.side, scoreOrder: 2 });
  });
})();
