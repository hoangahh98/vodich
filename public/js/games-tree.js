(() => {
  const stage = document.querySelector('[data-game="tree"]');
  if (!stage) return;
  const { sound, speakVi, confetti, pick } = window.GameCore;
  const tree = stage.querySelector('[data-tree]');
  const layer = stage.querySelector('[data-apple-layer]');
  const hint = stage.querySelector('[data-tree-hint]');
  const startOverlay = stage.querySelector('[data-tree-start]');
  const startBtn = stage.querySelector('[data-start]');
  const shakeBtn = stage.querySelector('[data-shake]');

  const NUMS = ['một', 'hai', 'ba', 'bốn', 'năm'];
  const G = 0.7;
  const APPLE = 56;
  let apples = [];
  let W = 0;
  let H = 0;
  let groundY = 0;
  let collected = 0;
  let running = false;

  function measure() {
    W = stage.clientWidth;
    H = stage.clientHeight;
    groundY = H - 90 - APPLE;
  }

  function canopy() {
    // Vùng tán cây (phần trên màn hình) để treo táo.
    const cx = W / 2;
    const topY = Math.max(70, H * 0.12);
    const spreadX = Math.min(W * 0.38, 200);
    const spreadY = Math.min(H * 0.22, 170);
    return {
      x: cx + (Math.random() * 2 - 1) * spreadX - APPLE / 2,
      y: topY + Math.random() * spreadY,
    };
  }

  function makeApple() {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tree-apple';
    el.textContent = '🍎';
    const p = canopy();
    const apple = { el, x: p.x, y: p.y, vx: 0, vy: 0, state: 'hanging' };
    el.style.transform = 'translate(' + apple.x + 'px,' + apple.y + 'px)';
    el.addEventListener('click', (e) => { e.stopPropagation(); collect(apple); });
    layer.appendChild(el);
    apples.push(apple);
  }

  function grow(n) {
    for (let i = 0; i < n; i++) makeApple();
  }

  function collect(apple) {
    if (apple.state === 'gone') return;
    apple.state = 'gone';
    sparkle(apple.x + APPLE / 2, apple.y + APPLE / 2);
    apple.el.remove();
    apples = apples.filter((a) => a !== apple);
    collected += 1;
    const n = ((collected - 1) % 5);
    speakVi(NUMS[n]);
    if (collected % 5 === 0) { sound('cheer'); confetti(); }
    else sound('pop');
    if (!apples.length) setTimeout(() => grow(6), 500); // hết táo -> mọc lại
  }

  function shake() {
    if (!running) return;
    tree.classList.remove('tree-wiggle');
    void tree.offsetWidth;
    tree.classList.add('tree-wiggle');
    let dropped = 0;
    apples.forEach((a) => {
      if (a.state === 'hanging' && dropped < 4 && Math.random() < 0.7) {
        a.state = 'falling';
        a.vx = (Math.random() * 2 - 1) * 3;
        a.vy = Math.random() * 2;
        dropped += 1;
      }
    });
    if (hint) hint.textContent = 'Chạm vào táo rụng để nhặt! ✨';
  }

  function tick() {
    apples.forEach((a) => {
      if (a.state !== 'falling') return;
      a.vy += G;
      a.x += a.vx;
      a.y += a.vy;
      if (a.x < 0) { a.x = 0; a.vx = -a.vx * 0.6; }
      if (a.x > W - APPLE) { a.x = W - APPLE; a.vx = -a.vx * 0.6; }
      if (a.y >= groundY) {
        a.y = groundY;
        if (a.vy > 3) { a.vy = -a.vy * 0.35; a.vx *= 0.6; } // nảy nhẹ
        else { a.vy = 0; a.vx = 0; a.state = 'ground'; }
      }
      a.el.style.transform = 'translate(' + a.x + 'px,' + a.y + 'px)';
    });
    requestAnimationFrame(tick);
  }

  function sparkle(x, y) {
    const emojis = ['✨', '⭐', '🌟', '💫'];
    for (let i = 0; i < 10; i++) {
      const s = document.createElement('span');
      s.className = 'bubble-particle';
      s.textContent = pick(emojis);
      const ang = (Math.PI * 2 * i) / 10;
      const d = 30 + Math.random() * 60;
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', Math.cos(ang) * d + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * d + 'px');
      stage.appendChild(s);
      setTimeout(() => s.remove(), 800);
    }
  }

  // --- Cảm biến lắc ---
  let lastMag = 0;
  let lastShakeAt = 0;
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
    const delta = Math.abs(mag - lastMag);
    lastMag = mag;
    const now = Date.now();
    if (delta > 16 && now - lastShakeAt > 450) { lastShakeAt = now; shake(); }
  }
  function enableMotion() {
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
      DME.requestPermission().then((s) => { if (s === 'granted') window.addEventListener('devicemotion', onMotion); }).catch(() => {});
    } else if (DME) {
      window.addEventListener('devicemotion', onMotion);
    }
  }

  function start() {
    running = true;
    startOverlay && startOverlay.classList.add('hidden');
    measure();
    grow(6);
    enableMotion();
    requestAnimationFrame(tick);
  }

  startBtn && startBtn.addEventListener('click', start);
  shakeBtn && shakeBtn.addEventListener('click', shake);
  tree.addEventListener('click', shake); // chạm vào cây cũng lắc (dự phòng máy tính)

  let rW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === rW && Math.abs(stage.clientHeight - H) < 60) { measure(); return; }
    rW = window.innerWidth;
    measure();
    // Giữ táo trong màn hình sau khi đổi kích thước.
    apples.forEach((a) => {
      a.x = Math.min(Math.max(0, a.x), W - APPLE);
      if (a.state !== 'hanging') a.y = Math.min(a.y, groundY);
      a.el.style.transform = 'translate(' + a.x + 'px,' + a.y + 'px)';
    });
  });
})();
