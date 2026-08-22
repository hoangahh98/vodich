/**
 * Vòng quay chia trận — phần GIAO DIỆN (kiểu wheelofnames.com).
 *
 * Chia việc làm ba lớp, đừng gộp lại:
 *   - public/js/spin-pairing.js — LUẬT bốc cặp, bản sao quy tắc của server, có test.
 *   - public/js/wheel.js        — bánh xe: vẽ múi và tính góc dừng, dùng chung với /vong-quay.
 *   - file này                  — nối hai thứ trên vào khung modal của trang lịch thi đấu.
 *
 * Người trúng được QUYẾT ĐỊNH TRƯỚC bởi spin-pairing rồi mới tính góc dừng sao cho múi của
 * người đó nằm dưới kim — chứ không phải quay ngẫu nhiên rồi đọc xem trúng ai. Làm ngược lại
 * là vòng quay tự bốc theo luật riêng, lệch hẳn với nút "Chia trận" ở server.
 *
 * Một đội cần hai người nên mỗi lượt quay HAI lần: lần đầu bốc trong nhóm bên trái (ví dụ
 * "Trình A"), lần sau bốc trong nhóm bên phải ("Trình D"). Rule không phân trình thì cả hai
 * lần đều quay trên cùng một danh sách, lần sau đã bỏ người vừa trúng ra.
 *
 * Kết quả gửi về đúng endpoint ghép cặp thủ công đã có sẵn
 * (POST /tournaments/:id/manual-schedule), không cần route riêng.
 */
(() => {
  const modal = document.querySelector('[data-spin-modal]');
  const pairing = window.VodichSpinPairing;
  const wheelKit = window.VodichWheel;
  if (!modal || !pairing || !wheelKit) return;

  const REDUCED = wheelKit.reducedMotion();
  const LAND_MS = REDUCED ? 120 : 520;
  const READY_MS = REDUCED ? 0 : 220;

  let players = [];
  try {
    players = JSON.parse(modal.dataset.players || '[]');
  } catch (_) {
    players = [];
  }
  const rule = modal.dataset.rule === 'RANDOM' ? 'RANDOM' : 'BY_SKILL';

  const wheel = wheelKit.attach(modal.querySelector('[data-spin-wheel]'), { spinMs: 3400 });
  const poolBox = modal.querySelector('[data-spin-pool]');
  const pickedBox = modal.querySelector('[data-spin-picked]');
  const resultsBox = modal.querySelector('[data-spin-results]');
  const totalBox = modal.querySelector('[data-spin-total]');
  const hintBox = modal.querySelector('[data-spin-hint]');
  const form = modal.querySelector('[data-spin-form]');
  const countInput = modal.querySelector('[data-spin-count]');
  const inputsBox = modal.querySelector('[data-spin-inputs]');
  const buttons = [...modal.querySelectorAll('[data-spin-once], [data-spin-all]')];

  let draw = null;
  let teams = [];
  let spinning = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function renderPicked(picked) {
    pickedBox.innerHTML = [0, 1]
      .map((slot) => `<span class="spin-slot ${picked[slot] ? 'filled' : ''}">${escapeHtml(picked[slot] || '?')}</span>`)
      .join('<span class="spin-plus">+</span>');
  }

  function renderResults() {
    resultsBox.innerHTML = teams
      .map(([first, second]) => `<li>${escapeHtml(first)} <span class="spin-vs">+</span> ${escapeHtml(second || pairing.WAITING_PARTNER)}</li>`)
      .join('');
    totalBox.textContent = String(teams.length);
  }

  /** Vẽ sẵn bánh xe của lượt sắp tới (chưa bốc ai) để khung không bao giờ trống trơn. */
  function showNextWheel() {
    const upcoming = draw.preview();
    if (!upcoming) return false;
    poolBox.textContent = upcoming.labels[0];
    wheel.render(upcoming.sources[0]);
    return true;
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

    const picked = ['', ''];
    for (const slot of [0, 1]) {
      const names = result.sources[slot];
      poolBox.textContent = result.labels[slot];
      wheel.render(names);
      renderPicked(picked);
      await wait(READY_MS);
      // Trùng tên hiển thị thì highlight nhầm bản sao, nhưng tên đội ghi ra vẫn đúng.
      await wheel.spinTo(Math.max(0, names.indexOf(result.team[slot])));
      picked[slot] = result.team[slot];
      renderPicked(picked);
      await wait(LAND_MS);
    }

    teams.push(result.team);
    renderResults();
    spinning = false;
    if (!showNextWheel()) {
      finish();
      return false;
    }
    setBusy(false);
    return true;
  }

  /**
   * Bốc nốt phần còn lại mà KHÔNG quay: 8 đội × 2 lượt × hơn 3 giây là ngồi nhìn cả phút.
   * Ai muốn xem quay thì bấm "Quay" từng lượt.
   */
  function drawRest() {
    if (spinning) return;
    for (let result = draw.next(); result; result = draw.next()) teams.push(result.team);
    finish();
  }

  function finish() {
    const remaining = draw.leftoverName();
    if (remaining) teams.push([remaining, '']);
    renderResults();
    poolBox.textContent = teams.length ? 'Đã bốc xong' : 'Chưa có vận động viên';
    pickedBox.innerHTML = '';
    setBusy(true);
    hintBox.textContent = teams.length ? 'Đã bốc xong. Kiểm tra lại rồi chốt danh sách.' : 'Chưa có vận động viên nào để bốc.';
    if (!teams.length) {
      wheel.render([]);
      return;
    }

    // Bánh xe cuối cùng bày luôn các đội vừa bốc, thay vì để trơ một hình tròn trống.
    wheel.render(teams.map(([first, second]) => `${first} + ${second || pairing.WAITING_PARTNER}`));
    countInput.value = String(teams.length);
    inputsBox.innerHTML = teams
      .map(([first, second], index) => `<input type="hidden" name="teamA_${index + 1}" value="${escapeHtml(first)}"><input type="hidden" name="teamB_${index + 1}" value="${escapeHtml(second)}">`)
      .join('');
    form.classList.remove('hidden');
  }

  function setBusy(busy) {
    for (const button of buttons) button.disabled = busy;
    modal.classList.toggle('spinning', busy);
  }

  function reset() {
    draw = pairing.createDraw(players, rule);
    teams = [];
    spinning = false;
    wheel.reset();
    resultsBox.innerHTML = '';
    totalBox.textContent = '0';
    inputsBox.innerHTML = '';
    countInput.value = '0';
    form.classList.add('hidden');
    renderPicked(['', '']);
    hintBox.textContent =
      rule === 'RANDOM'
        ? 'Không phân trình: cả hai lượt quay đều bốc trong cùng một danh sách.'
        : 'Phân trình: mỗi đội quay hai lần, mỗi lần một mức trình được ghép với nhau.';
    if (showNextWheel()) setBusy(false);
    else finish();
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
    else if (target.closest('[data-spin-all]')) drawRest();
  });

  reset();
})();
