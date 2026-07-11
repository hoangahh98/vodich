(() => {
  const stage = document.querySelector('[data-game="peekaboo"]');
  if (!stage) return;
  const { sound, speakVi, pick, shuffle } = window.GameCore;
  const grid = stage.querySelector('[data-peek-grid]');
  const hint = stage.querySelector('[data-peek-hint]');

  const SPOTS = ['🌳', '🚪', '🪨', '☁️', '📦', '🌾'];
  const ANIMALS = [
    { e: '🐶', v: 'con chó', s: 'Gâu gâu' }, { e: '🐱', v: 'con mèo', s: 'Meo meo' },
    { e: '🐮', v: 'con bò', s: 'Ụm bò' }, { e: '🐔', v: 'con gà', s: 'Ò ó o' },
    { e: '🐷', v: 'con lợn', s: 'Ụt ịt' }, { e: '🐸', v: 'con ếch', s: 'Ộp ộp' },
    { e: '🦆', v: 'con vịt', s: 'Cạc cạc' }, { e: '🐑', v: 'con cừu', s: 'Be be' },
    { e: '🐭', v: 'con chuột', s: 'Chít chít' }, { e: '🦁', v: 'sư tử', s: 'Gừ gừ' },
  ];

  function newScene() {
    grid.innerHTML = '';
    const spots = shuffle(SPOTS).slice(0, 4);
    spots.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.className = 'peek-spot';
      btn.type = 'button';
      btn.textContent = emoji;
      btn.dataset.state = '0';
      btn.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        tap(btn);
      });
      grid.appendChild(btn);
    });
  }

  function tap(btn) {
    const state = btn.dataset.state;
    if (state === '0') {
      btn.dataset.state = '1';
      btn.classList.add('peek-wiggle');
      sound('rustle');
      setTimeout(() => btn.classList.remove('peek-wiggle'), 500);
    } else if (state === '1') {
      btn.dataset.state = '2';
      const animal = pick(ANIMALS);
      btn.textContent = animal.e;
      btn.classList.add('peek-reveal');
      if (hint) hint.textContent = 'Chạm nền để chơi cảnh mới! 🔄';
      speakVi(animal.s);
      setTimeout(() => speakVi(animal.v), 1100);
    }
    // state '2': đã hiện, không làm gì (chạm nền để reset)
  }

  // Chạm nền (ngoài các chỗ nấp) -> cảnh mới nếu đã có con vật hiện ra.
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.peek-spot') || ev.target.closest('.game-back')) return;
    if (grid.querySelector('.peek-spot[data-state="2"]')) newScene();
  });

  newScene();
})();
