/**
 * Vòng quay bốc thăm trực tiếp cho vòng loại Knockout (Tứ kết, Bán kết).
 * Sử dụng VodichWheel đã tích hợp sẵn trên hệ thống.
 */
(() => {
  const modal = document.querySelector('[data-ko-modal]');
  const wheelKit = window.VodichWheel;
  if (!modal || !wheelKit) return;

  const wheelEl = modal.querySelector('[data-ko-wheel]');
  if (!wheelEl) return;

  const wheel = wheelKit.attach(wheelEl, { spinMs: 3000 });
  const poolBox = modal.querySelector('[data-ko-pool]');
  const pickedBox = modal.querySelector('[data-ko-picked]');
  const resultsBox = modal.querySelector('[data-ko-results]');
  const totalBox = modal.querySelector('[data-ko-total]');
  const titleBox = modal.querySelector('[data-ko-title]');
  const subtitleBox = modal.querySelector('[data-ko-subtitle]');
  const form = modal.querySelector('[data-ko-form]');
  const stageInput = modal.querySelector('[data-ko-stage]');
  const countInput = modal.querySelector('[data-ko-count]');
  const inputsBox = modal.querySelector('[data-ko-inputs]');
  const spinOnceBtn = modal.querySelector('[data-ko-once]');
  const spinAllBtn = modal.querySelector('[data-ko-all]');
  const resetBtn = modal.querySelector('[data-ko-reset]');
  const closeBtns = modal.querySelectorAll('[data-ko-close]');

  let stage = '';
  let actionUrl = '';
  let initialTeams = [];
  let remainingTeams = [];
  let currentPair = [];
  let pairs = [];
  let spinning = false;

  function escapeHtml(val) {
    return String(val == null ? '' : val).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function renderWheel() {
    if (remainingTeams.length > 0) {
      if (poolBox) poolBox.textContent = `Còn lại ${remainingTeams.length} đội trong lồng bốc`;
      wheel.render(remainingTeams);
    } else {
      if (poolBox) poolBox.textContent = 'Đã bốc thăm xong toàn bộ các cặp đấu';
      wheel.render(['Hoàn tất']);
    }
  }

  function renderPicked() {
    if (!pickedBox) return;
    if (currentPair.length === 0) {
      pickedBox.innerHTML = '<span class="spin-slot">Đội 1: ?</span> <span class="spin-plus">vs</span> <span class="spin-slot">Đội 2: ?</span>';
    } else if (currentPair.length === 1) {
      pickedBox.innerHTML = `<span class="spin-slot filled">${escapeHtml(currentPair[0])}</span> <span class="spin-plus">vs</span> <span class="spin-slot">Đội 2: ?</span>`;
    } else {
      pickedBox.innerHTML = `<span class="spin-slot filled">${escapeHtml(currentPair[0])}</span> <span class="spin-plus">vs</span> <span class="spin-slot filled">${escapeHtml(currentPair[1])}</span>`;
    }
  }

  function renderResults() {
    if (!resultsBox) return;
    resultsBox.innerHTML = pairs
      .map((p, idx) => `<li><strong>Trận ${idx + 1}:</strong> ${escapeHtml(p.teamA)} <span class="spin-vs">vs</span> ${escapeHtml(p.teamB)}</li>`)
      .join('');
    if (totalBox) totalBox.textContent = String(pairs.length);
  }

  function checkDone() {
    if (remainingTeams.length === 0 && currentPair.length === 0) {
      if (spinOnceBtn) spinOnceBtn.disabled = true;
      if (spinAllBtn) spinAllBtn.disabled = true;
      if (form) {
        form.action = actionUrl;
        if (stageInput) stageInput.value = stage;
        if (countInput) countInput.value = String(pairs.length);
        if (inputsBox) {
          inputsBox.innerHTML =
            pairs
              .map(
                (p, idx) => `
              <input type="hidden" name="teamA_${idx + 1}" value="${escapeHtml(p.teamA)}">
              <input type="hidden" name="teamB_${idx + 1}" value="${escapeHtml(p.teamB)}">
            `,
              )
              .join('') + `<input type="hidden" name="pairs" value='${escapeHtml(JSON.stringify(pairs))}'>`;
        }
        form.classList.remove('hidden');
      }
    } else {
      if (spinOnceBtn) spinOnceBtn.disabled = false;
      if (spinAllBtn) spinAllBtn.disabled = false;
      if (form) form.classList.add('hidden');
    }
  }

  async function spinOnce() {
    if (spinning || remainingTeams.length === 0) return;
    spinning = true;
    if (spinOnceBtn) spinOnceBtn.disabled = true;
    if (spinAllBtn) spinAllBtn.disabled = true;

    const winnerIdx = Math.floor(Math.random() * remainingTeams.length);
    const chosenTeam = remainingTeams[winnerIdx];

    await wheel.spinTo(winnerIdx);

    remainingTeams.splice(winnerIdx, 1);
    currentPair.push(chosenTeam);
    renderPicked();

    if (currentPair.length === 2) {
      pairs.push({ teamA: currentPair[0], teamB: currentPair[1] });
      currentPair = [];
      renderResults();
    }

    renderWheel();
    spinning = false;
    checkDone();
  }

  async function spinAll() {
    if (spinning || remainingTeams.length === 0) return;
    while (remainingTeams.length > 0) {
      await spinOnce();
    }
  }

  function reset() {
    spinning = false;
    remainingTeams = [...initialTeams];
    currentPair = [];
    pairs = [];
    renderPicked();
    renderResults();
    renderWheel();
    checkDone();
    wheel.reset();
  }

  function open(stg, action, teams) {
    stage = stg;
    actionUrl = action;
    initialTeams = Array.isArray(teams) ? [...teams] : [];
    if (titleBox) titleBox.innerHTML = `Bốc thăm ${escapeHtml(stage)}`;
    if (subtitleBox) subtitleBox.textContent = `Bốc ngẫu nhiên chia các cặp đấu vòng ${stage}`;
    modal.classList.remove('hidden');
    reset();
  }

  function close() {
    modal.classList.add('hidden');
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-ko-draw]');
    if (!btn) return;
    const stg = btn.dataset.stage || 'Tứ kết';
    const action = btn.dataset.action || '';
    let tms = [];
    try {
      tms = JSON.parse(btn.dataset.teams || '[]');
    } catch (_) {}
    open(stg, action, tms);
  });

  if (spinOnceBtn) spinOnceBtn.addEventListener('click', spinOnce);
  if (spinAllBtn) spinAllBtn.addEventListener('click', spinAll);
  if (resetBtn) resetBtn.addEventListener('click', reset);
  closeBtns.forEach((b) => b.addEventListener('click', close));
})();
