// Game "Hiệp Sĩ Toán Học" — vòng lặp game (state machine) thuần vanilla JS.
// Tương đương một component React quản lý: playerHp, monsterHp, câu hỏi, đồng hồ 180s.
// (Dự án dùng EJS + CSP script-src 'self', không có pipeline React, nên viết native.)
(() => {
  const stage = document.querySelector('[data-game="knight"]');
  if (!stage) return;
  const { sound, praise, encourage, confetti, speakVi } = window.GameCore;

  // ---- Cấu hình từ server (nhúng qua data-*) ----
  const parseData = (attr, fallback) => {
    try { return JSON.parse(decodeURIComponent(stage.dataset[attr] || '')); } catch (_) { return fallback; }
  };
  const CONFIG = {
    aiOn: stage.dataset.ai === '1',
    maxHp: Number(stage.dataset.maxHp) || 10,
    maxStage: Number(stage.dataset.maxStage) || 10,
    stages: parseData('stages', []),
    QUESTION_TIME: 180, // giây mỗi câu
  };

  // ---- Trạng thái toàn cục ----
  const S = {
    characters: parseData('characters', []),
    character: null,
    // combat
    stageMeta: null,
    questions: [],
    qIndex: 0,
    playerHp: CONFIG.maxHp,
    monsterHp: 0,
    monsterMaxHp: 0,
    wrongThisStage: 0,
    locked: false,
    timerId: null,
    timeLeft: CONFIG.QUESTION_TIME,
    genderForm: 'boy',
    ageForm: 5,
  };

  const $ = (sel) => stage.querySelector(sel);
  const $$ = (sel) => Array.from(stage.querySelectorAll(sel));
  const HERO_EMOJI = { boy: '🧒', girl: '👧' };

  // ---- Điều hướng màn hình ----
  function showScreen(name) {
    $$('.knight-screen').forEach((s) => s.classList.toggle('hidden', s.dataset.screen !== name));
    hideOverlay();
  }

  // ========================= MÀN 1: CHỌN NHÂN VẬT =========================
  function renderCharList() {
    const list = $('[data-char-list]');
    list.innerHTML = '';
    if (!S.characters.length) {
      list.innerHTML = '<div class="knight-empty">Chưa có hiệp sĩ nào. Tạo một bạn nhé! 👇</div>';
      return;
    }
    S.characters.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'knight-char-card';
      const done = (c.clearedStages || []).length;
      const badge = c.status === 'VICTORY' ? '👑 Đã cứu công chúa!' : `Ải ${c.currentStage}/${CONFIG.maxStage}`;
      card.innerHTML =
        '<button class="knight-char-del" type="button" title="Xoá">🗑️</button>' +
        '<div class="knight-char-face">' + (HERO_EMOJI[c.gender] || '🧒') + '</div>' +
        '<div class="knight-char-name"></div>' +
        '<div class="knight-char-meta">' + c.age + ' tuổi · ' + badge + '</div>' +
        '<div class="knight-char-progress">🏅 ' + done + ' ải đã qua</div>' +
        '<button class="knight-btn knight-btn-primary knight-char-play" type="button">▶ Chơi tiếp</button>';
      card.querySelector('.knight-char-name').textContent = c.name;
      card.querySelector('.knight-char-play').addEventListener('click', () => selectCharacter(c));
      card.querySelector('.knight-char-del').addEventListener('click', (e) => { e.stopPropagation(); deleteCharacter(c); });
      list.appendChild(card);
    });
  }

  function selectCharacter(c) {
    S.character = c;
    enterMap();
  }

  // Hộp xác nhận TRONG app (nhiều webview mobile chặn window.confirm -> nút xoá "không ăn").
  function deleteCharacter(c) {
    showOverlay({
      emoji: '🗑️', title: 'Xoá hiệp sĩ?', stars: 0,
      text: 'Xoá "' + c.name + '"? Toàn bộ tiến trình của bạn ấy sẽ mất.',
      actions: [
        { label: '🗑️ Xoá luôn', primary: true, fn: () => doDeleteCharacter(c) },
        { label: 'Huỷ', primary: false, fn: hideOverlay },
      ],
    });
  }

  async function doDeleteCharacter(c) {
    try {
      const res = await fetch('/games/hiep-si/character/delete', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: c.id }),
      });
      if (res.ok) {
        S.characters = S.characters.filter((x) => x.id !== c.id);
        renderCharList();
        if (!S.characters.length) { resetCreateForm(); showScreen('create'); }
      } else {
        const d = await res.json().catch(() => ({}));
        showOverlay({ emoji: '⚠️', title: 'Không xoá được', stars: 0, text: d.error || 'Thử lại nhé.', actions: [{ label: 'OK', primary: true, fn: hideOverlay }] });
      }
    } catch (_) {
      showOverlay({ emoji: '⚠️', title: 'Lỗi mạng', stars: 0, text: 'Không kết nối được, thử lại nhé.', actions: [{ label: 'OK', primary: true, fn: hideOverlay }] });
    }
  }

  // ========================= MÀN 2: TẠO NHÂN VẬT =========================
  function initCreateForm() {
    $('[data-new-char]').addEventListener('click', () => { resetCreateForm(); showScreen('create'); });
    $('[data-create-cancel]').addEventListener('click', () => showScreen(S.characters.length ? 'select' : 'create'));
    $('[data-f-gender]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-gender]'); if (!btn) return;
      S.genderForm = btn.dataset.gender;
      $$('[data-f-gender] .knight-gender-btn').forEach((b) => b.classList.toggle('active', b === btn));
    });
    $('[data-f-age]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-age]'); if (!btn) return;
      S.ageForm = Number(btn.dataset.age);
      $$('[data-f-age] .knight-age-btn').forEach((b) => b.classList.toggle('active', b === btn));
    });
    $('[data-create-save]').addEventListener('click', saveCharacter);
  }

  function resetCreateForm() {
    $('[data-f-name]').value = '';
    $('[data-f-notes]').value = '';
    $('[data-create-msg]').textContent = '';
    S.genderForm = 'boy';
    S.ageForm = 5;
    $$('[data-f-gender] .knight-gender-btn').forEach((b) => b.classList.toggle('active', b.dataset.gender === 'boy'));
    $$('[data-f-age] .knight-age-btn').forEach((b) => b.classList.toggle('active', b.dataset.age === '5'));
  }

  async function saveCharacter() {
    const name = $('[data-f-name]').value.trim();
    const msg = $('[data-create-msg]');
    if (!name) { msg.textContent = 'Nhập tên hiệp sĩ nhé!'; return; }
    const btn = $('[data-create-save]');
    btn.disabled = true; msg.textContent = 'Đang tạo...';
    try {
      const res = await fetch('/games/hiep-si/character', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, gender: S.genderForm, age: S.ageForm, notes: $('[data-f-notes]').value.trim() }),
      });
      const data = await res.json();
      if (data.character) {
        S.characters.unshift(data.character);
        renderCharList();
        selectCharacter(data.character);
      } else {
        msg.textContent = data.error || 'Không tạo được, thử lại nhé.';
      }
    } catch (_) {
      msg.textContent = 'Mạng có vấn đề, thử lại nhé.';
    } finally {
      btn.disabled = false;
    }
  }

  // ========================= MÀN 3: BẢN ĐỒ ẢI =========================
  function enterMap() {
    showScreen('map');
    const c = S.character;
    $('[data-hero-chip]').textContent = (HERO_EMOJI[c.gender] || '🧒') + ' ' + c.name;
    renderMap();
  }

  function renderMap() {
    const c = S.character;
    const map = $('[data-map]');
    map.innerHTML = '';
    const cleared = new Set(c.clearedStages || []);
    CONFIG.stages.forEach((st) => {
      const node = document.createElement('button');
      node.type = 'button';
      const isCleared = cleared.has(st.stage);
      const isCurrent = st.stage === c.currentStage && c.status !== 'VICTORY';
      const locked = st.stage > c.currentStage && !isCleared;
      node.className = 'knight-stage' + (isCleared ? ' cleared' : '') + (isCurrent ? ' current' : '') + (locked ? ' locked' : '');
      const stars = (c.stars && c.stars[st.stage]) || 0;
      const starRow = isCleared ? '<div class="knight-stage-stars">' + '⭐'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars)) + '</div>' : '';
      node.innerHTML =
        '<div class="knight-stage-no">Ải ' + st.stage + (st.monster.type === 'boss' ? ' 👑' : '') + '</div>' +
        '<div class="knight-stage-emoji">' + (locked ? '🔒' : st.monster.emoji) + '</div>' +
        '<div class="knight-stage-title">' + st.title + '</div>' +
        starRow;
      if (!locked) node.addEventListener('click', () => startStage(st.stage));
      map.appendChild(node);
    });
    if (c.status === 'VICTORY') {
      showOverlay({ emoji: '👑', title: 'Đã cứu công chúa!', stars: 0, text: 'Bé đã hoàn thành mọi ải. Quá giỏi! Có thể chơi lại ải bất kỳ để luyện thêm.', actions: [{ label: 'Chơi lại', primary: true, fn: hideOverlay }] });
    }
  }

  // ========================= MÀN 4: CHIẾN ĐẤU =========================
  async function startStage(stageNumber) {
    const c = S.character;
    showScreen('combat');
    S.locked = true;
    S.qIndex = 0;
    S.wrongThisStage = 0;
    S.playerHp = CONFIG.maxHp;
    $('[data-hero-avatar]').textContent = HERO_EMOJI[c.gender] || '🧒';
    $('[data-hero-name]').textContent = c.name;
    $('[data-question]').textContent = 'Đang triệu hồi câu hỏi... 🔮';
    $('[data-choices]').innerHTML = '';
    $('[data-visual]').textContent = '';
    $('[data-feedback]').textContent = '';
    renderHp();

    try {
      const res = await fetch('/games/hiep-si/quiz', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: c.id, stage: stageNumber }),
      });
      const data = await res.json();
      if (!data.stage || !Array.isArray(data.questions) || !data.questions.length) {
        $('[data-question]').textContent = data.error || 'Không tạo được câu hỏi, thử lại nhé.';
        addRetry(stageNumber);
        return;
      }
      S.stageMeta = data.stage;
      S.questions = data.questions;
      S.monsterMaxHp = data.stage.monster.hp;
      S.monsterHp = data.stage.monster.hp;
      $('[data-stage-name]').textContent = 'Ải ' + data.stage.stage + ': ' + data.stage.title;
      $('[data-monster-avatar]').textContent = data.stage.monster.emoji;
      $('[data-monster-name]').textContent = data.stage.monster.name + (data.stage.monster.type === 'boss' ? ' 👑' : '');
      renderHp();
      S.locked = false;
      loadQuestion();
    } catch (_) {
      $('[data-question]').textContent = 'Mạng có vấn đề, thử lại nhé.';
      addRetry(stageNumber);
    }
  }

  function addRetry(stageNumber) {
    const box = $('[data-choices]');
    box.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'knight-btn knight-btn-primary';
    btn.type = 'button';
    btn.textContent = '🔄 Thử lại';
    btn.addEventListener('click', () => startStage(stageNumber));
    box.appendChild(btn);
  }

  function renderHp() {
    $('[data-hero-hp]').innerHTML = hearts(S.playerHp, CONFIG.maxHp);
    $('[data-monster-hp]').innerHTML = hearts(S.monsterHp, S.monsterMaxHp);
  }
  function hearts(cur, max) {
    let html = '';
    for (let i = 0; i < max; i++) html += '<span class="knight-heart">' + (i < cur ? '❤️' : '🤍') + '</span>';
    return html;
  }

  function loadQuestion() {
    if (!S.questions.length) return;
    const q = S.questions[S.qIndex % S.questions.length];
    S.locked = false;
    $('[data-feedback]').textContent = '';
    const box = $('[data-choices]');
    box.innerHTML = '';
    $('[data-question]').textContent = q.prompt;
    if (q.type === 'match' && Array.isArray(q.pairs)) {
      $('[data-visual]').textContent = '';
      $('[data-visual]').classList.add('hidden');
      renderMatch(q, box);
    } else {
      $('[data-visual]').textContent = q.visual || '';
      $('[data-visual]').classList.toggle('hidden', !q.visual);
      q.choices.forEach((choice, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'knight-choice';
        btn.textContent = choice;
        btn.addEventListener('click', () => answer(idx, btn, q));
        box.appendChild(btn);
      });
    }
    startTimer();
  }

  const repeatEmoji = (e, n) => Array.from({ length: n }, () => e).join('');

  // Câu NỐI: chạm 1 số bên trái -> chạm nhóm hình bên phải, đúng số lượng thì nối lại.
  function renderMatch(q, box) {
    const SVGNS = 'http://www.w3.org/2000/svg';
    const wrap = document.createElement('div');
    wrap.className = 'knight-match';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'knight-match-svg');
    const leftCol = document.createElement('div');
    leftCol.className = 'knight-match-col';
    const rightCol = document.createElement('div');
    rightCol.className = 'knight-match-col';
    const leftData = window.GameCore.shuffle(q.pairs.slice());
    const rightData = window.GameCore.shuffle(q.pairs.slice());
    const total = q.pairs.length;
    let selLeft = null;
    let done = 0;

    function drawLine(a, b) {
      const wr = wrap.getBoundingClientRect();
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', String(ra.right - wr.left));
      line.setAttribute('y1', String(ra.top + ra.height / 2 - wr.top));
      line.setAttribute('x2', String(rb.left - wr.left));
      line.setAttribute('y2', String(rb.top + rb.height / 2 - wr.top));
      line.setAttribute('class', 'knight-match-line');
      svg.appendChild(line);
    }

    leftData.forEach((p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'knight-match-item knight-match-num';
      el.textContent = String(p.n);
      el.dataset.n = String(p.n);
      el.addEventListener('click', () => {
        if (S.locked || el.classList.contains('done')) return;
        leftCol.querySelectorAll('.knight-match-item').forEach((x) => x.classList.remove('active'));
        el.classList.add('active');
        selLeft = el;
      });
      leftCol.appendChild(el);
    });

    rightData.forEach((p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'knight-match-item knight-match-group';
      el.textContent = repeatEmoji(p.emoji, p.n);
      el.dataset.n = String(p.n);
      el.addEventListener('click', () => {
        if (S.locked || el.classList.contains('done')) return;
        if (!selLeft) { $('[data-feedback]').textContent = '👉 Chạm một SỐ bên trái trước nhé'; return; }
        if (Number(selLeft.dataset.n) === Number(el.dataset.n)) {
          selLeft.classList.add('done'); selLeft.classList.remove('active');
          el.classList.add('done');
          drawLine(selLeft, el);
          sound('correct');
          selLeft = null;
          done += 1;
          if (done === total) {
            S.locked = true;
            stopTimer();
            $('[data-feedback]').textContent = praise();
            monsterTakeHitThenContinue();
          } else {
            $('[data-feedback]').textContent = '✅ Đúng rồi! Nối tiếp nào.';
          }
        } else {
          el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
          if (selLeft) selLeft.classList.remove('active');
          selLeft = null;
          sound('wrong');
          S.wrongThisStage += 1;
          $('[data-feedback]').textContent = 'Chưa đúng, đếm lại rồi nối nhé 😊';
        }
      });
      rightCol.appendChild(el);
    });

    wrap.appendChild(svg);
    wrap.appendChild(leftCol);
    wrap.appendChild(rightCol);
    box.appendChild(wrap);
  }

  // Đánh trúng quái 1 đòn rồi sang câu tiếp / kết thúc ải (dùng chung cho câu chọn & câu nối).
  function monsterTakeHitThenContinue() {
    S.monsterHp -= 1;
    renderHp();
    hitMonster();
    confetti();
    if (S.monsterHp <= 0) { setTimeout(stageCleared, 700); return; }
    setTimeout(loadNext, 800);
  }

  function startTimer() {
    stopTimer();
    S.timeLeft = CONFIG.QUESTION_TIME;
    updateTimer();
    S.timerId = setInterval(() => {
      S.timeLeft -= 1;
      updateTimer();
      if (S.timeLeft <= 0) { stopTimer(); onTimeout(); }
    }, 1000);
  }
  function stopTimer() { if (S.timerId) { clearInterval(S.timerId); S.timerId = null; } }
  function updateTimer() {
    const pct = Math.max(0, (S.timeLeft / CONFIG.QUESTION_TIME) * 100);
    const bar = $('[data-timer-bar]');
    bar.style.width = pct + '%';
    bar.classList.toggle('low', S.timeLeft <= 20);
    $('[data-timer-num]').textContent = Math.max(0, S.timeLeft);
  }

  function onTimeout() {
    if (S.locked) return;
    S.locked = true;
    $('[data-feedback]').textContent = '⏰ Hết giờ! Quái cắn mất 1 máu.';
    takeDamage();
    setTimeout(afterWrong, 900);
  }

  function answer(idx, btn, q) {
    if (S.locked) return;
    S.locked = true;
    stopTimer();
    const correct = idx === q.answer;
    if (correct) {
      btn.classList.add('correct');
      sound('correct');
      $('[data-feedback]').textContent = praise();
      monsterTakeHitThenContinue();
    } else {
      btn.classList.add('wrong');
      // đánh dấu đáp án đúng cho bé học
      const buttons = $$('.knight-choice');
      if (buttons[q.answer]) buttons[q.answer].classList.add('correct');
      sound('wrong');
      S.wrongThisStage += 1;
      $('[data-feedback]').textContent = encourage();
      takeDamage();
      setTimeout(afterWrong, 1100);
    }
  }

  function loadNext() {
    S.qIndex += 1;
    loadQuestion();
  }
  function afterWrong() {
    if (S.playerHp <= 0) { heroDown(); return; }
    loadNext();
  }

  function takeDamage() {
    S.playerHp -= 1;
    renderHp();
    const hero = $('.knight-hero');
    hero.classList.remove('hurt'); void hero.offsetWidth; hero.classList.add('hurt');
  }
  function hitMonster() {
    const m = $('.knight-monster');
    m.classList.remove('hit'); void m.offsetWidth; m.classList.add('hit');
  }

  // ---- Kết thúc ải ----
  async function stageCleared() {
    stopTimer();
    sound('win');
    confetti();
    const stars = S.wrongThisStage === 0 ? 3 : S.wrongThisStage <= 2 ? 2 : 1;
    const stageNum = S.stageMeta.stage;
    const isFinal = stageNum >= CONFIG.maxStage;
    await saveProgress({ stage: stageNum, hp: S.playerHp, cleared: true, stars });
    if (isFinal) {
      showOverlay({
        emoji: '👑', title: 'CHIẾN THẮNG!', stars,
        text: 'Hiệp sĩ ' + S.character.name + ' đã đánh bại Rồng Chúa và cứu được công chúa! 🎉',
        actions: [{ label: '🗺️ Về bản đồ', primary: true, fn: enterMap }],
      });
    } else {
      showOverlay({
        emoji: S.stageMeta.monster.emoji, title: 'Qua ải rồi!', stars,
        text: 'Tuyệt vời! Sẵn sàng cho ải tiếp theo chưa?',
        actions: [
          { label: '➡️ Ải tiếp theo', primary: true, fn: () => startStage(stageNum + 1) },
          { label: '🗺️ Bản đồ', primary: false, fn: enterMap },
        ],
      });
    }
  }

  async function heroDown() {
    stopTimer();
    sound('wrong');
    const stageNum = S.stageMeta.stage;
    await saveProgress({ stage: stageNum, hp: 0, cleared: false });
    showOverlay({
      emoji: '😴', title: 'Hiệp sĩ cần nghỉ ngơi', stars: -1,
      text: 'Hết máu rồi! Nghỉ một chút rồi thử lại ải này nhé — tiến trình các ải đã qua vẫn được giữ.',
      actions: [
        { label: '🔄 Thử lại ải này', primary: true, fn: () => startStage(stageNum) },
        { label: '🗺️ Bản đồ', primary: false, fn: enterMap },
      ],
    });
  }

  async function saveProgress(payload) {
    try {
      const res = await fetch('/games/hiep-si/progress', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ characterId: S.character.id }, payload)),
      });
      const data = await res.json();
      if (data.character) {
        S.character = data.character;
        // cập nhật trong danh sách
        const i = S.characters.findIndex((x) => x.id === data.character.id);
        if (i >= 0) S.characters[i] = data.character;
      }
    } catch (_) { /* lưu offline thất bại vẫn cho chơi tiếp */ }
  }

  // ---- Overlay ----
  function showOverlay(opt) {
    $('[data-overlay-emoji]').textContent = opt.emoji || '🎉';
    $('[data-overlay-title]').textContent = opt.title || '';
    const starsEl = $('[data-overlay-stars]');
    if (opt.stars && opt.stars > 0) starsEl.textContent = '⭐'.repeat(opt.stars) + '☆'.repeat(3 - opt.stars);
    else starsEl.textContent = '';
    $('[data-overlay-text]').textContent = opt.text || '';
    const actions = $('[data-overlay-actions]');
    actions.innerHTML = '';
    (opt.actions || []).forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'knight-btn' + (a.primary ? ' knight-btn-primary' : '');
      btn.textContent = a.label;
      btn.addEventListener('click', () => { hideOverlay(); a.fn && a.fn(); });
      actions.appendChild(btn);
    });
    $('[data-overlay]').classList.remove('hidden');
  }
  function hideOverlay() { $('[data-overlay]').classList.add('hidden'); }

  // ---- Nút chung ----
  $('[data-map-back]').addEventListener('click', () => { S.character = null; showScreen('select'); });
  $('[data-combat-back]').addEventListener('click', () => { stopTimer(); enterMap(); });

  // ========================= KHỞI ĐỘNG =========================
  function init() {
    initCreateForm();
    renderCharList();
    showScreen(S.characters.length ? 'select' : 'create');
  }
  init();
})();
