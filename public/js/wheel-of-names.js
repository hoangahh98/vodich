/**
 * Trang vòng quay đứng riêng (/vong-quay).
 *
 * Chỉ là lớp nối: bánh xe vẽ và quay ở public/js/wheel.js, ở đây lo ô nhập tên, chọn người
 * trúng và ghi lịch sử. Không gọi API nào, không đụng tới giải đấu/đội bóng — cố ý để nó là
 * công cụ vui đứng một mình như trang "Đọc điểm".
 *
 * Danh sách tên lưu trong localStorage của chính máy người dùng, không gửi lên server.
 */
(() => {
  const page = document.querySelector('[data-wheel-page]');
  const wheelKit = window.VodichWheel;
  if (!page || !wheelKit) return;

  const STORAGE_KEY = 'vodich.wheel.names';
  const LAND_MS = wheelKit.reducedMotion() ? 120 : 420;

  const wheel = wheelKit.attach(page.querySelector('[data-wheel-rotor]'), { spinMs: 4000 });
  const input = page.querySelector('[data-wheel-input]');
  const countBox = page.querySelector('[data-wheel-count]');
  const winnerBox = page.querySelector('[data-wheel-winner]');
  const historyBox = page.querySelector('[data-wheel-history]');
  const totalBox = page.querySelector('[data-wheel-total]');
  const removeToggle = page.querySelector('[data-wheel-remove]');
  const buttons = [...page.querySelectorAll('[data-wheel-spin]')];

  let history = [];
  let spinning = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  /** Mỗi dòng một tên; bỏ dòng trống để người dùng xuống dòng thoải mái. */
  const readNames = () =>
    String(input.value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  /** localStorage có thể bị chặn (chế độ riêng tư, iOS khoá) — hỏng chỗ này không được làm hỏng trang. */
  function saveNames() {
    try {
      window.localStorage.setItem(STORAGE_KEY, input.value);
    } catch (_) {
      /* không lưu được thì thôi, vòng quay vẫn chạy */
    }
  }

  function loadNames() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setBusy(busy) {
    spinning = busy;
    for (const button of buttons) button.disabled = busy;
  }

  function renderHistory() {
    historyBox.innerHTML = history.map((name) => `<li>${escapeHtml(name)}</li>`).join('');
    totalBox.textContent = String(history.length);
  }

  function refresh() {
    const names = readNames();
    wheel.render(names);
    countBox.textContent = names.length ? `${names.length} tên trên vòng quay` : 'Chưa có tên nào';
    for (const button of buttons) button.disabled = spinning || names.length < 1;
  }

  async function spin() {
    if (spinning) return;
    const names = wheel.names();
    if (!names.length) return;
    setBusy(true);
    winnerBox.textContent = '';

    const index = Math.floor(Math.random() * names.length);
    const winner = names[index];
    await wheel.spinTo(index);
    winnerBox.textContent = `🎉 ${winner}`;
    history.unshift(winner);
    renderHistory();
    await wait(LAND_MS);

    if (removeToggle.checked) {
      // Bỏ ĐÚNG dòng vừa trúng chứ không lọc theo tên: hai người trùng tên vẫn là hai suất.
      const lines = readNames();
      const at = lines.indexOf(winner);
      if (at >= 0) lines.splice(at, 1);
      input.value = lines.join('\n');
      saveNames();
      wheel.reset();
      refresh();
    }
    setBusy(false);
    refresh();
  }

  page.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-wheel-spin]')) void spin();
    else if (target.closest('[data-wheel-reset]')) {
      history = [];
      winnerBox.textContent = '';
      renderHistory();
      wheel.reset();
      refresh();
    }
  });

  input.addEventListener('input', () => {
    saveNames();
    refresh();
  });

  input.value = loadNames() || 'An\nBình\nCường\nDũng\nEm\nGiang';
  renderHistory();
  refresh();
})();
