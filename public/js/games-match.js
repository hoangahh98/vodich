(() => {
  const stage = document.querySelector('[data-game="match"]');
  if (!stage) return;
  const { sound, speakVi, confetti, shuffle } = window.GameCore;
  const grid = stage.querySelector('[data-match-grid]');
  const hint = stage.querySelector('[data-match-hint]');

  const ITEMS = [
    { e: '🐶', v: 'con chó' }, { e: '🐱', v: 'con mèo' }, { e: '🐰', v: 'con thỏ' }, { e: '🦁', v: 'sư tử' },
    { e: '🐸', v: 'con ếch' }, { e: '🐷', v: 'con lợn' }, { e: '🐵', v: 'con khỉ' }, { e: '🐘', v: 'con voi' },
    { e: '🍎', v: 'quả táo' }, { e: '🍌', v: 'quả chuối' }, { e: '🍓', v: 'quả dâu' }, { e: '🍉', v: 'dưa hấu' },
    { e: '🌸', v: 'bông hoa' }, { e: '🌻', v: 'hoa hướng dương' }, { e: '🌈', v: 'cầu vồng' }, { e: '⭐', v: 'ngôi sao' },
    { e: '🚗', v: 'ô tô' }, { e: '🚌', v: 'xe buýt' }, { e: '✈️', v: 'máy bay' }, { e: '🚂', v: 'tàu hỏa' },
  ];
  const PAIRS = 6;

  let first = null;
  let lock = false;
  let matched = 0;

  function newBoard() {
    grid.innerHTML = '';
    first = null;
    lock = false;
    matched = 0;
    if (hint) hint.textContent = 'Lật 2 hình giống nhau nhé! 🃏';
    const chosen = shuffle(ITEMS).slice(0, PAIRS);
    const deck = shuffle([...chosen, ...chosen]);
    const cols = deck.length <= 12 ? 3 : 4;
    // Thẻ cỡ cố định (không kéo giãn) để khối thẻ gọn và căn giữa được cả web lẫn mobile.
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, min(26vw, 110px)))';
    deck.forEach((item) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'match-card';
      card.innerHTML =
        '<div class="match-inner"><div class="match-face match-back">❓</div>' +
        '<div class="match-face match-front">' + item.e + '</div></div>';
      card.dataset.key = item.e;
      card.dataset.name = item.v;
      card.addEventListener('click', () => flip(card));
      grid.appendChild(card);
    });
  }

  function flip(card) {
    if (lock || card.classList.contains('flipped') || card.classList.contains('matched')) return;
    card.classList.add('flipped');
    sound('pop');
    if (!first) {
      first = card;
      return;
    }
    if (first.dataset.key === card.dataset.key) {
      // Khớp: đọc tên + biến mất.
      lock = true;
      speakVi(card.dataset.name);
      setTimeout(() => {
        first.classList.add('matched');
        card.classList.add('matched');
        first = null;
        lock = false;
        matched += 1;
        if (matched === PAIRS) win();
      }, 550);
    } else {
      // Không khớp: úp lại.
      lock = true;
      setTimeout(() => {
        first.classList.remove('flipped');
        card.classList.remove('flipped');
        first = null;
        lock = false;
      }, 850);
    }
  }

  function win() {
    if (hint) hint.textContent = 'Giỏi quá! 🎉 Ván mới nào...';
    sound('cheer');
    confetti();
    setTimeout(newBoard, 2200);
  }

  newBoard();
})();
