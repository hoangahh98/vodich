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
  const qualifierField = document.getElementById('knockoutQualifierField');
  if (!formatSelect || !qualifierField) return;
  const sync = () => qualifierField.classList.toggle('hidden', formatSelect.value !== 'GROUP_KNOCKOUT');
  formatSelect.addEventListener('change', sync);
  sync();
})();

(() => {
  const list = document.getElementById('matchList');
  if (!list || typeof io === 'undefined') return;
  const socket = io();
  const tournamentId = list.dataset.tournamentId;
  socket.emit('joinTournament', tournamentId);
  socket.on('scoreUpdated', (match) => {
    const row = list.querySelector(`[data-match-id="${match.id}"]`);
    if (!row) return;
    row.querySelector('.score-a').textContent = match.scoreA;
    row.querySelector('.score-b').textContent = match.scoreB;
    row.querySelector('.match-status').textContent = match.status;
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
    scoreAEl.textContent = String(scoreA);
    scoreBEl.textContent = String(scoreB);
    button.classList.add('loading');
    setTimeout(() => button.classList.remove('loading'), 250);
    socket.emit('score', { tournamentId, matchId: row.dataset.matchId, scoreA, scoreB, servingTeam: button.dataset.side, scoreOrder: 2 });
  });
})();
