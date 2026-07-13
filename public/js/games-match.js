(() => {
  const stage = document.querySelector('[data-game="match"]');
  if (!stage) return;
  const { sound, speakVi, confetti, shuffle } = window.GameCore;
  const grid = stage.querySelector('[data-match-grid]');
  const hint = stage.querySelector('[data-match-hint]');
  const movesEl = stage.querySelector('[data-match-moves]');

  const ITEMS = [
    { e: '🐶', v: 'con chó' }, { e: '🐱', v: 'con mèo' }, { e: '🐰', v: 'con thỏ' }, { e: '🦁', v: 'sư tử' },
    { e: '🐸', v: 'con ếch' }, { e: '🐷', v: 'con lợn' }, { e: '🐵', v: 'con khỉ' }, { e: '🐘', v: 'con voi' },
    { e: '🍎', v: 'quả táo' }, { e: '🍌', v: 'quả chuối' }, { e: '🍓', v: 'quả dâu' }, { e: '🍉', v: 'dưa hấu' },
    { e: '🌸', v: 'bông hoa' }, { e: '🌻', v: 'hoa hướng dương' }, { e: '🌈', v: 'cầu vồng' }, { e: '⭐', v: 'ngôi sao' },
    { e: '🚗', v: 'ô tô' }, { e: '🚌', v: 'xe buýt' }, { e: '✈️', v: 'máy bay' }, { e: '🚂', v: 'tàu hỏa' },
  ];

  // 3 mức: càng khó càng nhiều cặp, ít cột hơn -> khối to hơn nhưng nhiều thẻ hơn,
  // và thời gian úp lại thẻ sai NGẮN hơn (khó ghi nhớ hơn).
  const LEVELS = {
    easy: { pairs: 6, cols: 4, flipBack: 950, label: 'Dễ' },
    medium: { pairs: 8, cols: 4, flipBack: 700, label: 'Vừa' },
    hard: { pairs: 10, cols: 5, flipBack: 500, label: 'Khó' },
  };

  let level = 'easy';
  let first = null;
  let lock = false;
  let matched = 0;
  let moves = 0;

  function bestKey() { return 'game-match-best-' + level; }
  function readBest() { try { return Number(localStorage.getItem(bestKey())) || 0; } catch (_) { return 0; } }
  function writeBest(v) { try { localStorage.setItem(bestKey(), String(v)); } catch (_) {} }

  function renderMoves() {
    const best = readBest();
    const cfg = LEVELS[level];
    movesEl.textContent = '🃏 Cặp: ' + matched + '/' + cfg.pairs + '   👣 Lượt: ' + moves + (best ? '   🏆 Kỷ lục: ' + best : '');
  }

  function newBoard() {
    const cfg = LEVELS[level];
    grid.innerHTML = '';
    first = null;
    lock = false;
    matched = 0;
    moves = 0;
    if (hint) hint.textContent = 'Lật 2 hình giống nhau nhé! 🃏';
    renderMoves();
    const chosen = shuffle(ITEMS).slice(0, cfg.pairs);
    const deck = shuffle([...chosen, ...chosen]);
    // Kích thước thẻ co theo số cột để luôn vừa bề ngang (foldable/mobile friendly).
    const sizeVw = Math.floor(88 / cfg.cols);
    grid.style.gridTemplateColumns = 'repeat(' + cfg.cols + ', minmax(0, min(' + sizeVw + 'vw, 104px)))';
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
    moves += 1;
    renderMoves();
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
        renderMoves();
        if (matched === LEVELS[level].pairs) win();
      }, 550);
    } else {
      // Không khớp: úp lại (mức khó úp nhanh hơn).
      lock = true;
      setTimeout(() => {
        first.classList.remove('flipped');
        card.classList.remove('flipped');
        first = null;
        lock = false;
      }, LEVELS[level].flipBack);
    }
  }

  function win() {
    const best = readBest();
    if (!best || moves < best) writeBest(moves);
    if (hint) hint.textContent = 'Giỏi quá! 🎉 Xong ' + LEVELS[level].pairs + ' cặp trong ' + moves + ' lượt!';
    renderMoves();
    sound('cheer');
    confetti();
    setTimeout(newBoard, 2400);
  }

  // Chọn mức độ
  const levelsRow = stage.querySelector('[data-levels]');
  if (levelsRow) {
    levelsRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-level]');
      if (!btn) return;
      level = btn.dataset.level;
      levelsRow.querySelectorAll('.game-level').forEach((b) => b.classList.toggle('active', b === btn));
      newBoard();
    });
  }

  newBoard();
})();
