(() => {
  const stage = document.querySelector('[data-game="scratch"]');
  if (!stage) return;
  const { sound, speakVi, confetti, pick } = window.GameCore;
  const picture = stage.querySelector('[data-scratch-picture]');
  const canvas = stage.querySelector('[data-scratch-canvas]');
  const hint = stage.querySelector('[data-scratch-hint]');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const PICTURES = [
    { e: '🚗', v: 'ô tô', bg: 'linear-gradient(135deg,#ff9a9e,#fad0c4)' },
    { e: '🦖', v: 'khủng long', bg: 'linear-gradient(135deg,#a8edea,#43e97b)' },
    { e: '🚀', v: 'tên lửa', bg: 'linear-gradient(135deg,#30cfd0,#330867)' },
    { e: '🦄', v: 'kỳ lân', bg: 'linear-gradient(135deg,#f6d365,#fda085)' },
    { e: '🐬', v: 'cá heo', bg: 'linear-gradient(135deg,#4facfe,#00f2fe)' },
    { e: '👸', v: 'công chúa', bg: 'linear-gradient(135deg,#ff9a9e,#fecfef)' },
    { e: '🦸', v: 'siêu nhân', bg: 'linear-gradient(135deg,#f093fb,#f5576c)' },
    { e: '🏰', v: 'lâu đài', bg: 'linear-gradient(135deg,#fddb92,#d1fdff)' },
  ];
  let current = null;
  let done = false;
  let drawing = false;
  let checkPending = false;

  function fit() {
    canvas.width = stage.clientWidth;
    canvas.height = stage.clientHeight;
  }

  function newPicture() {
    done = false;
    current = pick(PICTURES);
    picture.style.background = current.bg;
    picture.textContent = current.e;
    hint && (hint.style.opacity = '1');
    fit();
    // Phủ lớp xám lên trên.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#9aa4b2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Vài chấm sáng để trông như lớp phủ nhám.
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 60; i++) ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 6, 6);
  }

  function erase(x, y) {
    if (done) return;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(34, canvas.width * 0.06), 0, Math.PI * 2);
    ctx.fill();
    if (hint) hint.style.opacity = '0';
    scheduleCheck();
  }

  function scheduleCheck() {
    if (checkPending) return;
    checkPending = true;
    setTimeout(() => {
      checkPending = false;
      if (percentCleared() > 0.7) finish();
    }, 250);
  }

  function percentCleared() {
    try {
      // Chỉ xét VÙNG HÌNH CHÍNH ở giữa (nơi có bức tranh), không tính nền trống quanh mép.
      const w = canvas.width;
      const h = canvas.height;
      const side = Math.floor(Math.min(w, h) * 0.62);
      const x0 = Math.floor((w - side) / 2);
      const y0 = Math.floor((h - side) / 2);
      const data = ctx.getImageData(x0, y0, side, side).data;
      let clear = 0;
      let total = 0;
      for (let i = 3; i < data.length; i += 32) { // lấy mẫu alpha
        total++;
        if (data[i] === 0) clear++;
      }
      return total ? clear / total : 0;
    } catch (_) {
      return 0;
    }
  }

  function finish() {
    done = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height); // lộ hết
    picture.classList.add('scratch-celebrate');
    sound('cheer');
    speakVi('Hoan hô! ' + current.v);
    confetti();
    setTimeout(() => {
      picture.classList.remove('scratch-celebrate');
      newPicture();
    }, 3000);
  }

  const pos = (ev) => {
    const r = canvas.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : ev;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const start = (ev) => { ev.preventDefault(); drawing = true; const p = pos(ev); erase(p.x, p.y); };
  const move = (ev) => { if (!drawing) return; ev.preventDefault(); const p = pos(ev); erase(p.x, p.y); };
  const end = () => { drawing = false; };

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  // Chặn thao tác mặc định (kéo làm mới, zoom) khi đang chơi.
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(newPicture, 200); // vẽ lại lớp phủ theo kích thước mới
  });

  newPicture();
})();
