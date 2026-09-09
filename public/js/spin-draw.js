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
 * Thi ĐÔI: một đội cần hai người nên mỗi lượt quay HAI lần: lần đầu bốc trong nhóm bên trái
 * (ví dụ "Trình A"), lần sau bốc trong nhóm bên phải ("Trình D"). Rule không phân trình thì cả
 * hai lần đều quay trên cùng một danh sách, lần sau đã bỏ người vừa trúng ra.
 * Thi ĐƠN (`data-play-type="SINGLES"`): mỗi lượt quay MỘT lần, bốc một người.
 * Đánh bảng (`data-group-count` > 1): bốc tới đâu xếp bảng tới đó — đội 1 vào A, đội 2 vào B,
 * ... quay vòng, khớp `splitGroups` ở server — và gửi kèm `group_i` để server xếp đúng bảng đã hiện.
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
  const singles = modal.dataset.playType === 'SINGLES';
  const groupCount = Math.max(1, Number.parseInt(modal.dataset.groupCount || '1', 10) || 1);
  /** Ô người trong một lượt: đôi hai ô, đơn một ô. */
  const SLOTS = singles ? [0] : [0, 1];
  const groupLetter = (index) => String.fromCharCode(65 + (index % groupCount));
  /** Đội đủ người mới có bảng: đội đôi mới có một người thì server ghép nốt rồi tự rải bảng. */
  const groupOfTeam = (team, index) => (groupCount > 1 && team.every(Boolean) ? groupLetter(index) : '');

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
  let seed = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  // ───────────────────────────── Lưu tạm bản nháp đang quay ─────────────────────────────
  //
  // Bấm nhầm nút Đóng, lỡ bấm back, hay rớt mạng giữa chừng thì không phải quay lại từ đầu.
  //
  // KHÔNG lưu danh sách đội đã bốc, mà lưu HẠT GIỐNG ngẫu nhiên + số đội đã bốc, rồi quay lại
  // đúng chừng ấy lượt để dựng lại y nguyên trạng thái. Lưu danh sách đội thì phần chưa bốc
  // vẫn phải bốc mới, và luật "gấp phần dư" sẽ tính lại trên rổ còn lại — ra kết quả khác với
  // nếu quay một mạch, tức là đóng ra mở vào lại đổi kèo.

  const STORAGE_KEY = `vodich.spin.${modal.dataset.tournamentId || '0'}`;
  /** Danh sách VĐV/rule đổi (thêm người, rút người) thì bản nháp cũ không còn đúng nữa. */
  const fingerprint = `${rule}|${singles ? 'SINGLES' : 'DOUBLES'}|${groupCount}|${players.map((player) => `${player.name}:${player.skill}`).join(',')}`;

  /**
   * Bộ bốc ngẫu nhiên CÓ HẠT GIỐNG (mulberry32) tiêm vào `createDraw` thay cho `Math.random`.
   * Cùng hạt giống thì cùng dãy số, nên quay lại N lượt là về đúng trạng thái cũ.
   */
  function seededPick(value) {
    let state = value >>> 0;
    return (size) => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return Math.floor(((((t ^ (t >>> 14)) >>> 0) / 4294967296) * size));
    };
  }

  /** localStorage có thể bị chặn (chế độ riêng tư, iOS khoá) — hỏng chỗ này không được phá vòng quay. */
  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ fingerprint, seed, drawn: teams.length }));
    } catch (_) {
      /* không lưu được thì thôi */
    }
  }

  function clearState() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* không xoá được thì thôi */
    }
  }

  function loadState() {
    try {
      const state = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (!state || state.fingerprint !== fingerprint) return null;
      if (!Number.isFinite(state.seed) || !Number.isFinite(state.drawn) || state.drawn < 1) return null;
      return state;
    } catch (_) {
      return null;
    }
  }

  function renderPicked(picked) {
    pickedBox.innerHTML = SLOTS
      .map((slot) => `<span class="spin-slot ${picked[slot] ? 'filled' : ''}">${escapeHtml(picked[slot] || '?')}</span>`)
      .join('<span class="spin-plus">+</span>');
  }

  function renderResults() {
    resultsBox.innerHTML = teams
      .map(([first, second], index) => {
        const names = singles ? escapeHtml(first) : `${escapeHtml(first)} <span class="spin-vs">+</span> ${escapeHtml(second || pairing.WAITING_PARTNER)}`;
        const group = groupOfTeam([first, singles ? first : second], index);
        return `<li>${names}${group ? ` <span class="spin-group">Bảng ${group}</span>` : ''}</li>`;
      })
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
    for (const slot of SLOTS) {
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
    saveState();
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
    saveState();
    poolBox.textContent = teams.length ? 'Đã bốc xong' : 'Chưa có vận động viên';
    pickedBox.innerHTML = '';
    setBusy(true);
    hintBox.textContent = teams.length ? 'Đã bốc xong. Kiểm tra lại rồi chốt danh sách.' : 'Chưa có vận động viên nào để bốc.';
    if (!teams.length) {
      wheel.render([]);
      return;
    }

    // Bánh xe cuối chỉ ghi SỐ đội, khớp với số thứ tự trong danh sách ngay bên dưới. Ghi cả
    // hai tên thì "Nguyễn Khắc Hoàng Anh + Lê Văn Cường Thịnh" bị co nhỏ tới mức không đọc nổi,
    // trong khi danh sách bên dưới đã ghi rõ ai với ai rồi.
    wheel.render(teams.map((_, index) => `Đội ${index + 1}`));
    countInput.value = String(teams.length);
    inputsBox.innerHTML = teams
      .map(([first, second], index) => {
        const group = groupOfTeam([first, singles ? first : second], index);
        return (
          `<input type="hidden" name="teamA_${index + 1}" value="${escapeHtml(first)}">` +
          (singles ? '' : `<input type="hidden" name="teamB_${index + 1}" value="${escapeHtml(second)}">`) +
          (group ? `<input type="hidden" name="group_${index + 1}" value="${group}">` : '')
        );
      })
      .join('');
    form.classList.remove('hidden');
  }

  function setBusy(busy) {
    for (const button of buttons) button.disabled = busy;
    modal.classList.toggle('spinning', busy);
  }

  /** Dựng lượt bốc từ một hạt giống, quay lại `replay` lượt đầu để về đúng trạng thái cũ. */
  function start(nextSeed, replay) {
    seed = nextSeed >>> 0;
    draw = singles ? pairing.createSinglesDraw(players, seededPick(seed)) : pairing.createDraw(players, rule, seededPick(seed));
    teams = [];
    spinning = false;
    for (let index = 0; index < replay; index++) {
      const result = draw.next();
      if (!result) break;
      teams.push(result.team);
    }
  }

  /** Vẽ lại toàn bộ khung theo trạng thái hiện tại của `draw`/`teams`. */
  function paint(hint) {
    wheel.reset();
    inputsBox.innerHTML = '';
    countInput.value = '0';
    form.classList.add('hidden');
    renderPicked(['', '']);
    renderResults();
    hintBox.textContent = hint;
    if (showNextWheel()) setBusy(false);
    else finish();
  }

  const groupHint = () => (groupCount > 1 ? ` Bốc tới đâu xếp bảng tới đó: đội 1 vào bảng A, đội 2 vào bảng B, ... (${groupCount} bảng).` : '');
  const ruleHint = () => {
    if (singles) return `Thi đơn: mỗi lượt quay bốc một người, thứ tự bốc là thứ tự đội.${groupHint()}`;
    return (
      (rule === 'RANDOM'
        ? 'Không phân trình: cả hai lượt quay đều bốc trong cùng một danh sách.'
        : 'Phân trình: mỗi đội quay hai lần, mỗi lần một mức trình được ghép với nhau.') + groupHint()
    );
  };

  function reset() {
    clearState();
    start(Math.floor(Math.random() * 0xffffffff), 0);
    paint(ruleHint());
  }

  /** Mở lại bản nháp đang dở, nếu có. Trả false khi không có gì để tiếp. */
  function restore() {
    const state = loadState();
    if (!state) return false;
    start(state.seed, state.drawn);
    if (!teams.length) return false;
    paint(`Đang tiếp bản nháp đã lưu (${teams.length} đội). Bấm "Làm lại" nếu muốn bốc lại từ đầu.`);
    return true;
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-spin-open]')) {
      if (!restore()) reset();
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

  // Chốt danh sách xong là bản nháp hết việc; để lại thì lần sau mở ra tưởng còn dở.
  form.addEventListener('submit', clearState);

  if (!restore()) reset();
})();
