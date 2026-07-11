(() => {
  const stage = document.querySelector('[data-game="bubbles"]');
  if (!stage) return;
  const { sound, speakVi, pick } = window.GameCore;
  const layer = stage.querySelector('[data-bubbles-layer]');
  const hint = stage.querySelector('[data-bubbles-hint]');

  const OBJECTS = [
    // Xe cộ
    { e: '🚗', v: 'ô tô' }, { e: '🚓', v: 'xe cảnh sát' }, { e: '🚒', v: 'xe cứu hỏa' }, { e: '🚑', v: 'xe cứu thương' },
    { e: '🚕', v: 'xe taxi' }, { e: '🚌', v: 'xe buýt' }, { e: '🚚', v: 'xe tải' }, { e: '🚜', v: 'máy cày' },
    { e: '🏍️', v: 'xe máy' }, { e: '🚲', v: 'xe đạp' }, { e: '🚂', v: 'tàu hỏa' }, { e: '✈️', v: 'máy bay' },
    { e: '🚁', v: 'trực thăng' }, { e: '🚀', v: 'tên lửa' }, { e: '🚢', v: 'tàu thủy' }, { e: '⛵', v: 'thuyền buồm' },
    // Động vật
    { e: '🐶', v: 'con chó' }, { e: '🐱', v: 'con mèo' }, { e: '🐘', v: 'con voi' }, { e: '🦁', v: 'sư tử' },
    { e: '🐯', v: 'con hổ' }, { e: '🐻', v: 'con gấu' }, { e: '🐼', v: 'gấu trúc' }, { e: '🐨', v: 'gấu túi' },
    { e: '🦊', v: 'con cáo' }, { e: '🐷', v: 'con lợn' }, { e: '🐮', v: 'con bò' }, { e: '🐴', v: 'con ngựa' },
    { e: '🐒', v: 'con khỉ' }, { e: '🐰', v: 'con thỏ' }, { e: '🐭', v: 'con chuột' }, { e: '🐸', v: 'con ếch' },
    { e: '🐔', v: 'con gà' }, { e: '🐥', v: 'gà con' }, { e: '🦆', v: 'con vịt' }, { e: '🦉', v: 'con cú' },
    { e: '🐧', v: 'chim cánh cụt' }, { e: '🦒', v: 'hươu cao cổ' }, { e: '🦓', v: 'ngựa vằn' }, { e: '🐍', v: 'con rắn' },
    { e: '🐢', v: 'con rùa' }, { e: '🐝', v: 'con ong' }, { e: '🦋', v: 'con bướm' }, { e: '🐟', v: 'con cá' },
    { e: '🐳', v: 'cá voi' }, { e: '🦈', v: 'cá mập' }, { e: '🦀', v: 'con cua' }, { e: '🐙', v: 'bạch tuộc' },
    // Trái cây & thiên nhiên
    { e: '🍎', v: 'quả táo' }, { e: '🍌', v: 'quả chuối' }, { e: '🍓', v: 'quả dâu' }, { e: '🍉', v: 'dưa hấu' },
    { e: '🍊', v: 'quả cam' }, { e: '🍇', v: 'chùm nho' }, { e: '🌸', v: 'bông hoa' }, { e: '🌈', v: 'cầu vồng' },
    { e: '⭐', v: 'ngôi sao' }, { e: '☀️', v: 'mặt trời' }, { e: '🌙', v: 'mặt trăng' }, { e: '⚽', v: 'quả bóng' },
  ];
  const COLORS = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3'];

  let popped = false;
  const rand = (min, max) => min + Math.random() * (max - min);

  function spawn() {
    const obj = pick(OBJECTS);
    const size = rand(90, 150);
    const bubble = document.createElement('button');
    bubble.className = 'magic-bubble';
    bubble.type = 'button';
    bubble.style.setProperty('--size', size + 'px');
    bubble.style.left = rand(4, 96 - (size / window.innerWidth) * 100) + 'vw';
    bubble.style.background = 'radial-gradient(circle at 32% 28%, rgba(255,255,255,.85), ' + pick(COLORS) + ' 75%)';
    const dur = rand(6, 10);
    bubble.style.animationDuration = dur + 's';
    bubble.textContent = obj.e;
    const onPop = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (bubble.dataset.gone) return;
      bubble.dataset.gone = '1';
      if (!popped) { popped = true; hint && hint.classList.add('hidden'); }
      const r = bubble.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2);
      sound('pop');
      speakVi(obj.v);
      bubble.classList.add('bubble-pop');
      setTimeout(() => bubble.remove(), 260);
    };
    // Dùng 'click' (không phải 'pointerdown'): iOS chỉ cho phép đọc tiếng nói từ click/touchend.
    bubble.addEventListener('click', onPop);
    bubble.addEventListener('animationend', () => bubble.remove());
    layer.appendChild(bubble);
  }

  function burst(x, y) {
    const emojis = ['🎉', '⭐', '✨', '🌟', '💫', '🎊'];
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('span');
      p.className = 'bubble-particle';
      p.textContent = pick(emojis);
      const angle = (Math.PI * 2 * i) / 12;
      const dist = rand(40, 110);
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  // Sinh bong bóng liên tục, vô tận.
  spawn();
  setInterval(spawn, 850);
})();
