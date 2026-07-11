(() => {
  const stage = document.querySelector('[data-game="shadow"]');
  if (!stage) return;
  const { sound, speakVi, confetti, pick, shuffle } = window.GameCore;
  const targetEl = stage.querySelector('[data-shadow-target]');
  const optionsEl = stage.querySelector('[data-shadow-options]');
  const hint = stage.querySelector('[data-shadow-hint]');

  const ITEMS = [
    { e: '🐘', v: 'con voi' }, { e: '🦁', v: 'sư tử' }, { e: '🐰', v: 'con thỏ' }, { e: '🐢', v: 'con rùa' },
    { e: '🦒', v: 'hươu cao cổ' }, { e: '🐧', v: 'chim cánh cụt' }, { e: '🦋', v: 'con bướm' }, { e: '🐟', v: 'con cá' },
    { e: '🍌', v: 'quả chuối' }, { e: '🍎', v: 'quả táo' }, { e: '🍉', v: 'dưa hấu' }, { e: '🌸', v: 'bông hoa' },
    { e: '🚗', v: 'ô tô' }, { e: '🚒', v: 'xe cứu hỏa' }, { e: '✈️', v: 'máy bay' }, { e: '🚂', v: 'tàu hỏa' },
    { e: '⭐', v: 'ngôi sao' }, { e: '🌙', v: 'mặt trăng' }, { e: '☂️', v: 'cái ô' }, { e: '🎈', v: 'bóng bay' },
  ];
  let lastTargetKey = '';
  let locked = false;

  function newRound() {
    locked = false;
    // Chọn 3 vật KHÁC NHAU; target không trùng lượt trước.
    let three = shuffle(ITEMS).slice(0, 3);
    while (three[0].e === lastTargetKey) three = shuffle(ITEMS).slice(0, 3);
    const target = three[0];
    lastTargetKey = target.e;

    targetEl.textContent = target.e;
    targetEl.classList.remove('shadow-pop');
    // ép reflow để animation chạy lại
    void targetEl.offsetWidth;
    targetEl.classList.add('shadow-pop');

    optionsEl.innerHTML = '';
    shuffle(three).forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shadow-opt';
      btn.textContent = item.e;
      btn.dataset.key = item.e;
      btn.addEventListener('click', () => choose(btn, item, target));
      optionsEl.appendChild(btn);
    });
    if (hint) hint.textContent = 'Hình này là bóng nào? Chạm vào bóng đúng nhé! 🕵️';
  }

  function choose(btn, item, target) {
    if (locked) return;
    if (item.e === target.e) {
      locked = true;
      btn.classList.add('shadow-correct');
      sound('cheer');
      confetti();
      speakVi('Chính xác! ' + target.v);
      if (hint) hint.textContent = 'Giỏi quá! 🎉';
      setTimeout(newRound, 1900);
    } else {
      // Sai: rung nhẹ, tiếng "uh-oh", không phạt.
      btn.classList.add('shadow-wrong');
      sound('wrong');
      setTimeout(() => btn.classList.remove('shadow-wrong'), 500);
    }
  }

  newRound();
})();
