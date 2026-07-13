(() => {
  const stage = document.querySelector('[data-game="match"]');
  if (!stage) return;
  const { sound, speakVi, confetti, shuffle } = window.GameCore;
  const grid = stage.querySelector('[data-match-grid]');
  const hint = stage.querySelector('[data-match-hint]');
  const movesEl = stage.querySelector('[data-match-moves]');
  const scoreEl = stage.querySelector('[data-match-score]');

  const ITEMS = [
    { e: '🐶', v: 'con chó' }, { e: '🐱', v: 'con mèo' }, { e: '🐰', v: 'con thỏ' }, { e: '🦁', v: 'sư tử' },
    { e: '🐸', v: 'con ếch' }, { e: '🐷', v: 'con lợn' }, { e: '🐵', v: 'con khỉ' }, { e: '🐘', v: 'con voi' },
    { e: '🐯', v: 'con hổ' }, { e: '🐮', v: 'con bò' }, { e: '🐔', v: 'con gà' }, { e: '🐧', v: 'chim cánh cụt' },
    { e: '🦋', v: 'con bướm' }, { e: '🐢', v: 'con rùa' }, { e: '🐠', v: 'con cá' }, { e: '🐝', v: 'con ong' },
    { e: '🦉', v: 'con cú' }, { e: '🦄', v: 'kỳ lân' }, { e: '🐬', v: 'cá heo' }, { e: '🐨', v: 'gấu túi' },
    { e: '🍎', v: 'quả táo' }, { e: '🍌', v: 'quả chuối' }, { e: '🍓', v: 'quả dâu' }, { e: '🍉', v: 'dưa hấu' },
    { e: '🍇', v: 'quả nho' }, { e: '🍊', v: 'quả cam' }, { e: '🍑', v: 'quả đào' }, { e: '🍍', v: 'quả dứa' },
    { e: '🌸', v: 'bông hoa' }, { e: '🌻', v: 'hoa hướng dương' }, { e: '🌈', v: 'cầu vồng' }, { e: '⭐', v: 'ngôi sao' },
    { e: '🌙', v: 'mặt trăng' }, { e: '☀️', v: 'mặt trời' }, { e: '⚽', v: 'quả bóng' }, { e: '🎈', v: 'bong bóng' },
    { e: '🚗', v: 'ô tô' }, { e: '🚌', v: 'xe buýt' }, { e: '✈️', v: 'máy bay' }, { e: '🚂', v: 'tàu hỏa' },
  ];

  // 4 mức: càng khó càng nhiều cặp, ít thời gian úp lại thẻ sai (khó ghi nhớ hơn).
  // superhard: bảng 6 cột x 10 hàng = 60 thẻ = 30 cặp (dành cho 2 người thi nhau).
  const LEVELS = {
    easy: { pairs: 6, cols: 4, flipBack: 950, label: 'Dễ' },
    medium: { pairs: 8, cols: 4, flipBack: 700, label: 'Vừa' },
    hard: { pairs: 10, cols: 5, flipBack: 500, label: 'Khó' },
    superhard: { pairs: 30, cols: 6, flipBack: 450, label: 'Siêu khó' },
  };

  let level = 'easy';
  let mode = '1p';          // '1p' = 1 người, '2p' = 2 người thi đấu
  let first = null;
  let lock = false;
  let matched = 0;
  let moves = 0;
  let current = 0;          // 0 = Người 1, 1 = Người 2 (chỉ dùng khi 2 người)
  let scores = [0, 0];

  function bestKey() { return 'game-match-best-' + level; }
  function readBest() { try { return Number(localStorage.getItem(bestKey())) || 0; } catch (_) { return 0; } }
  function writeBest(v) { try { localStorage.setItem(bestKey(), String(v)); } catch (_) {} }

  function renderMoves() {
    const best = readBest();
    const cfg = LEVELS[level];
    movesEl.textContent = '🃏 Cặp: ' + matched + '/' + cfg.pairs + '   👣 Lượt: ' + moves + (best ? '   🏆 Kỷ lục: ' + best : '');
  }

  function renderScore() {
    if (!scoreEl) return;
    if (mode !== '2p') { scoreEl.hidden = true; scoreEl.innerHTML = ''; return; }
    scoreEl.hidden = false;
    scoreEl.innerHTML =
      '<div class="score-panel' + (current === 0 ? ' turn' : '') + '"><span class="score-who">👦 Người 1</span><span class="score-num">' + scores[0] + '</span></div>' +
      '<div class="score-panel' + (current === 1 ? ' turn' : '') + '"><span class="score-who">👧 Người 2</span><span class="score-num">' + scores[1] + '</span></div>';
  }

  function newBoard() {
    const cfg = LEVELS[level];
    grid.innerHTML = '';
    first = null;
    lock = false;
    matched = 0;
    moves = 0;
    current = 0;
    scores = [0, 0];
    if (hint) {
      hint.textContent = mode === '2p'
        ? 'Người 1 & Người 2 thay phiên lật. Lật đúng thì được đi tiếp! 👦👧'
        : 'Lật 2 hình giống nhau nhé! 🃏';
    }
    renderMoves();
    renderScore();
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

  function nextTurn() {
    current = current === 0 ? 1 : 0;
    renderScore();
    if (hint) hint.textContent = current === 0 ? '👦 Đến lượt Người 1!' : '👧 Đến lượt Người 2!';
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
      // Khớp: đọc tên + biến mất. Người đang chơi được cộng điểm và đi tiếp.
      lock = true;
      speakVi(card.dataset.name);
      if (mode === '2p') {
        scores[current] += 1;
        renderScore();
        if (hint) hint.textContent = (current === 0 ? '👦 Người 1' : '👧 Người 2') + ' ăn được 1 cặp! Đi tiếp 🎉';
      }
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
      // Không khớp: úp lại (mức khó úp nhanh hơn). 2 người thì chuyển lượt.
      lock = true;
      setTimeout(() => {
        first.classList.remove('flipped');
        card.classList.remove('flipped');
        first = null;
        lock = false;
        if (mode === '2p') nextTurn();
      }, LEVELS[level].flipBack);
    }
  }

  function win() {
    if (mode === '2p') {
      let msg;
      if (scores[0] > scores[1]) msg = '🏆 Người 1 thắng! ' + scores[0] + ' - ' + scores[1];
      else if (scores[1] > scores[0]) msg = '🏆 Người 2 thắng! ' + scores[1] + ' - ' + scores[0];
      else msg = '🤝 Hòa nhau! ' + scores[0] + ' - ' + scores[1];
      if (hint) hint.textContent = msg;
      renderScore();
      sound('cheer');
      confetti();
      setTimeout(newBoard, 3600);
      return;
    }
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

  // Chọn số người chơi
  const modesRow = stage.querySelector('[data-modes]');
  if (modesRow) {
    modesRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      mode = btn.dataset.mode;
      modesRow.querySelectorAll('.game-level').forEach((b) => b.classList.toggle('active', b === btn));
      newBoard();
    });
  }

  newBoard();
})();
