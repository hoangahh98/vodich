/**
 * Vòng quay chia trận — phần GIAO DIỆN.
 *
 * Toàn bộ quy tắc bốc cặp nằm ở public/js/spin-pairing.js (thuần logic, có test). Ở đây chỉ có
 * chuyện hiện ô quay, chạy tên cho vui mắt rồi đổ kết quả ra form.
 *
 * Kết quả gửi về đúng endpoint ghép cặp thủ công đã có sẵn
 * (POST /tournaments/:id/manual-schedule), không cần route riêng.
 */
(() => {
  const modal = document.querySelector('[data-spin-modal]');
  const pairing = window.VodichSpinPairing;
  if (!modal || !pairing) return;

  const SPIN_MS = 1100;
  const TICK_MS = 60;

  let players = [];
  try {
    players = JSON.parse(modal.dataset.players || '[]');
  } catch (_) {
    players = [];
  }
  const rule = modal.dataset.rule === 'RANDOM' ? 'RANDOM' : 'BY_SKILL';

  const reelsBox = modal.querySelector('[data-spin-reels]');
  const resultsBox = modal.querySelector('[data-spin-results]');
  const totalBox = modal.querySelector('[data-spin-total]');
  const hintBox = modal.querySelector('[data-spin-hint]');
  const form = modal.querySelector('[data-spin-form]');
  const countInput = modal.querySelector('[data-spin-count]');
  const inputsBox = modal.querySelector('[data-spin-inputs]');
  const onceBtn = modal.querySelector('[data-spin-once]');
  const allBtn = modal.querySelector('[data-spin-all]');

  let draw = null;
  let teams = [];
  let spinning = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function renderReels(labels) {
    reelsBox.innerHTML = labels
      .map((label) => `<div class="spin-reel"><div class="spin-reel-label">${escapeHtml(label)}</div><div class="spin-reel-window"><span class="spin-reel-name">—</span></div></div>`)
      .join('');
    return [...reelsBox.querySelectorAll('.spin-reel-name')];
  }

  /** Cho tên nhảy loạn trong ô rồi dừng ở kết quả — phần "quay" người dùng nhìn thấy. */
  function runReels(slots, sources, finalNames) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        slots.forEach((slot, index) => {
          const names = sources[index] || [];
          if (names.length) slot.textContent = names[Math.floor(Math.random() * names.length)];
        });
        if (Date.now() - started < SPIN_MS) return;
        window.clearInterval(timer);
        slots.forEach((slot, index) => {
          slot.textContent = finalNames[index] || pairing.WAITING_PARTNER;
          slot.classList.add('landed');
        });
        window.setTimeout(resolve, 260);
      }, TICK_MS);
    });
  }

  function renderResults() {
    resultsBox.innerHTML = teams
      .map(([first, second]) => `<li>${escapeHtml(first)} <span class="spin-vs">+</span> ${escapeHtml(second || pairing.WAITING_PARTNER)}</li>`)
      .join('');
    totalBox.textContent = String(teams.length);
  }

  async function spinOnce() {
    if (spinning) return false;
    const result = draw.next();
    if (!result) {
      finish();
      return false;
    }
    spinning = true;
    setBusy(true);

    const slots = renderReels(result.labels);
    await runReels(slots, result.sources, [result.team[0], result.team[1] || pairing.WAITING_PARTNER]);

    teams.push(result.team);
    renderResults();
    spinning = false;
    setBusy(false);
    return true;
  }

  async function spinAll() {
    if (spinning) return;
    let more = true;
    while (more) more = await spinOnce();
  }

  function finish() {
    const remaining = draw.leftoverName();
    if (remaining) {
      teams.push([remaining, '']);
      renderResults();
    }
    reelsBox.innerHTML = '';
    hintBox.textContent = teams.length ? 'Đã bốc xong. Kiểm tra lại rồi chốt danh sách.' : 'Chưa có vận động viên nào để bốc.';
    onceBtn.disabled = true;
    allBtn.disabled = true;
    if (!teams.length) return;

    countInput.value = String(teams.length);
    inputsBox.innerHTML = teams
      .map(([first, second], index) => `<input type="hidden" name="teamA_${index + 1}" value="${escapeHtml(first)}"><input type="hidden" name="teamB_${index + 1}" value="${escapeHtml(second)}">`)
      .join('');
    form.classList.remove('hidden');
  }

  function setBusy(busy) {
    onceBtn.disabled = busy;
    allBtn.disabled = busy;
  }

  function reset() {
    draw = pairing.createDraw(players, rule);
    teams = [];
    spinning = false;
    reelsBox.innerHTML = '';
    resultsBox.innerHTML = '';
    totalBox.textContent = '0';
    inputsBox.innerHTML = '';
    countInput.value = '0';
    form.classList.add('hidden');
    onceBtn.disabled = false;
    allBtn.disabled = false;
    hintBox.textContent = rule === 'RANDOM' ? 'Không phân trình: bốc lần lượt từng cặp.' : 'Phân trình: mỗi lượt quay hai ô để ghép hai mức trình với nhau.';
    if (!players.length) finish();
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-spin-open]')) {
      reset();
      modal.classList.remove('hidden');
      return;
    }
    if (target.closest('[data-spin-close]')) {
      modal.classList.add('hidden');
      return;
    }
    if (modal.classList.contains('hidden')) return;
    if (target.closest('[data-spin-reset]')) reset();
    else if (target.closest('[data-spin-once]')) void spinOnce();
    else if (target.closest('[data-spin-all]')) void spinAll();
  });

  reset();
})();
