// Game "Hiệp Sĩ Toán Học" — vòng lặp game (state machine) thuần vanilla JS.
// Tương đương một component React quản lý: playerHp, monsterHp, câu hỏi, đồng hồ 180s.
// (Dự án dùng EJS + CSP script-src 'self', không có pipeline React, nên viết native.)
(() => {
  const stage = document.querySelector('[data-game="knight"]');
  if (!stage) return;
  const { sound, praise, encourage, confetti, speakVi, pick } = window.GameCore;

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
    wave: [], // đợt quái của ải
    mobIndex: 0, // con quái đang đánh
    wrongThisStage: 0,
    locked: false,
    timerId: null,
    timeLeft: CONFIG.QUESTION_TIME,
    genderForm: 'boy',
    ageForm: 5,
    level: 'medium', // độ khó do người chơi chọn (dễ/vừa/khó)
  };

  const $ = (sel) => stage.querySelector(sel);
  const $$ = (sel) => Array.from(stage.querySelectorAll(sel));
  const HERO_EMOJI = { boy: '🧒', girl: '👧' };

  // ---- Điều hướng màn hình ----
  function showScreen(name) {
    $$('.knight-screen').forEach((s) => s.classList.toggle('hidden', s.dataset.screen !== name));
    hideOverlay();
  }

  // ---- Mạng: hiện "đang xử lý", tự thử lại tối đa 3 lần, hỏng thì báo đổi mạng ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function showNet(msg) { const el = $('[data-net]'); if (el) { el.textContent = msg; el.classList.remove('hidden'); } }
  function hideNet() { const el = $('[data-net]'); if (el) el.classList.add('hidden'); }

  // Trả về { ok, data, network }. Tự retry 3 lần khi mạng lỗi/quá tải.
  // opts.silent: không hiện "đang xử lý" ở lần đầu (dùng cho lưu nền); vẫn báo khi phải thử lại.
  async function postJson(url, body, opts) {
    const maxAttempts = 3;
    if (!(opts && opts.silent)) showNet('⏳ Đang xử lý...');
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { hideNet(); return { ok: true, data: await res.json() }; }
        if ((res.status >= 500 || res.status === 429) && attempt < maxAttempts) {
          showNet('⏳ Máy chủ bận, thử lại (' + attempt + '/' + maxAttempts + ')...');
          await sleep(attempt * 800);
          continue;
        }
        hideNet();
        return { ok: false, data: await res.json().catch(() => ({})), status: res.status };
      } catch (_) {
        if (attempt < maxAttempts) {
          showNet('📶 Mạng chập chờn, thử lại (' + attempt + '/' + maxAttempts + ')...');
          await sleep(attempt * 900);
          continue;
        }
        hideNet();
        return { ok: false, network: true };
      }
    }
    hideNet();
    return { ok: false, network: true };
  }
  const NET_MSG = '📶 Mạng yếu quá! Hãy đổi sang Wi-Fi hoặc 4G khác rồi thử lại nhé.';

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
    const r = await postJson('/games/hiep-si/character/delete', { characterId: c.id });
    if (r.ok) {
      S.characters = S.characters.filter((x) => x.id !== c.id);
      renderCharList();
      if (!S.characters.length) { resetCreateForm(); showScreen('create'); }
    } else {
      showOverlay({ emoji: '⚠️', title: r.network ? 'Lỗi mạng' : 'Không xoá được', stars: 0, text: r.network ? NET_MSG : (r.data && r.data.error) || 'Thử lại nhé.', actions: [{ label: 'OK', primary: true, fn: hideOverlay }] });
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
    const r = await postJson('/games/hiep-si/character', { name, gender: S.genderForm, age: S.ageForm, notes: $('[data-f-notes]').value.trim() });
    btn.disabled = false;
    if (r.ok && r.data.character) {
      msg.textContent = '';
      S.characters.unshift(r.data.character);
      renderCharList();
      selectCharacter(r.data.character);
    } else {
      msg.textContent = r.network ? NET_MSG : (r.data && r.data.error) || 'Không tạo được, thử lại nhé.';
    }
  }

  // ========================= MÀN 3: BẢN ĐỒ ẢI =========================
  function enterMap() {
    showScreen('map');
    const c = S.character;
    $('[data-hero-chip]').textContent = (HERO_EMOJI[c.gender] || '🧒') + ' ' + c.name;
    renderMap();
  }

  // Chọn độ khó (Dễ/Vừa/Khó) — áp dụng cho các ải chơi sau đó.
  const diffRow = $('[data-diff]');
  if (diffRow) {
    diffRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-level]');
      if (!btn) return;
      S.level = btn.dataset.level;
      diffRow.querySelectorAll('.knight-diff-btn').forEach((b) => b.classList.toggle('active', b === btn));
    });
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
    $('[data-hero-avatar]').textContent = HERO_EMOJI[c.gender] || '🧒';
    $('[data-hero-name]').textContent = c.name;
    $('[data-question]').textContent = 'Đang triệu hồi câu hỏi... 🔮';
    $('[data-choices]').innerHTML = '';
    $('[data-visual]').textContent = '';
    $('[data-feedback]').textContent = '';

    // Chơi tiếp đúng con quái đã đánh dở của ải hiện tại (nếu còn máu).
    const resuming = stageNumber === c.currentStage && c.status === 'ACTIVE' && (c.mobIndex || 0) > 0 && c.hp > 0;
    S.playerHp = resuming ? c.hp : CONFIG.maxHp;
    renderHp();

    const r = await postJson('/games/hiep-si/quiz', { characterId: c.id, stage: stageNumber, level: S.level });
    if (!r.ok) {
      $('[data-question]').textContent = r.network ? NET_MSG : (r.data && r.data.error) || 'Không tạo được câu hỏi, thử lại nhé.';
      addRetry(stageNumber);
      return;
    }
    const data = r.data;
    if (!data.stage || !Array.isArray(data.questions) || !data.questions.length) {
      $('[data-question]').textContent = (data && data.error) || 'Không tạo được câu hỏi, thử lại nhé.';
      addRetry(stageNumber);
      return;
    }
    S.stageMeta = data.stage;
    S.questions = data.questions;
    S.wave = Array.isArray(data.wave) && data.wave.length ? data.wave : [{ name: 'Quái', emoji: '👾', type: 'normal', hp: 10 }];
    S.mobIndex = resuming ? Math.min(c.mobIndex, S.wave.length - 1) : 0;
    $('[data-stage-name]').textContent = 'Ải ' + data.stage.stage + ': ' + data.stage.title;
    spawnMonster();
    S.locked = false;
    loadQuestion();
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

  // Hiện con quái hiện tại của đợt.
  function spawnMonster() {
    const m = S.wave[S.mobIndex] || { name: 'Quái', emoji: '👾', type: 'normal', hp: 1 };
    S.monsterMaxHp = m.hp;
    S.monsterHp = m.hp;
    const isBoss = m.type === 'boss';
    const av = $('[data-monster-avatar]');
    av.textContent = m.emoji;
    av.classList.toggle('boss', isBoss);
    $('[data-monster-name]').textContent = (isBoss ? '👑 BOSS: ' : '') + m.name;
    const wp = $('[data-wave-progress]');
    if (wp) wp.textContent = isBoss ? '👑 BOSS xuất hiện!' : ('👾 Quái ' + (S.mobIndex + 1) + '/' + S.wave.length);
    renderHp();
    const mm = $('.knight-monster');
    if (mm) { mm.classList.remove('spawn'); void mm.offsetWidth; mm.classList.add('spawn'); }
    if (isBoss) sound('win');
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
      const vis = $('[data-visual]');
      if (typeof q.clock === 'number') {
        vis.innerHTML = '';
        vis.appendChild(buildClock(q.clock));
        vis.classList.remove('hidden');
      } else {
        vis.textContent = q.visual || '';
        vis.classList.toggle('hidden', !q.visual);
      }
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

  // Vẽ đồng hồ kim rõ ràng cho câu "mấy giờ" (kim ngắn = giờ, kim dài = số 12).
  function buildClock(hour) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'knight-clock');
    const cx = 50, cy = 50;
    const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); svg.appendChild(el); return el; };
    add('circle', { cx, cy, r: 46, fill: '#fffdf5', stroke: '#3a2c6e', 'stroke-width': 4 });
    // 12 số quanh mặt đồng hồ
    for (let n = 1; n <= 12; n++) {
      const a = (n * 30) * Math.PI / 180;
      const x = cx + 37 * Math.sin(a);
      const y = cy - 37 * Math.cos(a) + 4.5;
      const t = add('text', { x, y, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 'bold', fill: '#3a2c6e' });
      t.textContent = String(n);
    }
    // kim phút (dài) chỉ số 12
    add('line', { x1: cx, y1: cy, x2: cx, y2: 14, stroke: '#2d6cdf', 'stroke-width': 3, 'stroke-linecap': 'round' });
    // kim giờ (ngắn, đậm) chỉ vào số giờ
    const ah = (hour % 12) * 30 * Math.PI / 180;
    add('line', { x1: cx, y1: cy, x2: cx + 24 * Math.sin(ah), y2: cy - 24 * Math.cos(ah), stroke: '#e2413b', 'stroke-width': 5, 'stroke-linecap': 'round' });
    add('circle', { cx, cy, r: 3.5, fill: '#3a2c6e' });
    return svg;
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
            heroAttack();
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
    if (S.monsterHp <= 0) {
      // Con quái hiện tại gục -> nổ tung "ựa" ra rồi biến mất.
      const mm = $('.knight-monster');
      if (mm) { mm.classList.remove('faint'); void mm.offsetWidth; mm.classList.add('faint'); }
      monsterFx('💥');
      monsterFx('🤢', 0.1);
      monsterFx(pick(['💫', '⭐', '😵']), 0.2);
      S.mobIndex += 1;
      if (S.mobIndex >= S.wave.length) { setTimeout(stageCleared, 750); return; }
      // Lưu nền: đã đánh tới con quái thứ mấy của ải này (chơi tiếp đúng chỗ).
      saveProgress({ stage: S.stageMeta.stage, mobIndex: S.mobIndex, hp: S.playerHp, cleared: false }, true);
      setTimeout(() => { spawnMonster(); loadNext(); }, 800);
      return;
    }
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
    monsterBite();
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
      heroAttack();
    } else {
      btn.classList.add('wrong');
      // đánh dấu đáp án đúng cho bé học
      const buttons = $$('.knight-choice');
      if (buttons[q.answer]) buttons[q.answer].classList.add('correct');
      sound('wrong');
      S.wrongThisStage += 1;
      $('[data-feedback]').textContent = encourage();
      monsterBite();
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
    if (m) { m.classList.remove('hit'); void m.offsetWidth; m.classList.add('hit'); }
    // "Ựa ra": quái giật nảy văng ra 💥 + sao đom đóm.
    monsterFx('💥');
    monsterFx(pick(['💫', '😵', '⭐', '💢']), 0.12);
  }
  function monsterFx(txt, delay) {
    const arena = $('.knight-arena');
    if (!arena) return;
    const s = document.createElement('span');
    s.className = 'knight-monster-fx';
    s.textContent = txt;
    if (delay) s.style.animationDelay = delay + 's';
    arena.appendChild(s);
    setTimeout(() => s.remove(), 850);
  }

  // Đúng: hiệp sĩ bắn 1 quả cầu lửa bay sang quái rồi mới trừ máu quái.
  function heroAttack() {
    shootFireball();
    setTimeout(monsterTakeHitThenContinue, 360);
  }
  function shootFireball() {
    const arena = $('.knight-arena');
    if (!arena) return;
    const fb = document.createElement('span');
    fb.className = 'knight-fireball';
    fb.textContent = '🔥';
    arena.appendChild(fb);
    setTimeout(() => fb.remove(), 650);
  }
  // Sai/hết giờ: quái vật lao vào cắn hiệp sĩ.
  function monsterBite() {
    const m = $('.knight-monster');
    if (m) { m.classList.remove('bite'); void m.offsetWidth; m.classList.add('bite'); }
    const arena = $('.knight-arena');
    if (!arena) return;
    const b = document.createElement('span');
    b.className = 'knight-bite';
    b.textContent = '💥';
    arena.appendChild(b);
    setTimeout(() => b.remove(), 600);
  }

  // ---- Kết thúc ải ----
  async function stageCleared() {
    stopTimer();
    sound('win');
    confetti();
    const stars = S.wrongThisStage === 0 ? 3 : S.wrongThisStage <= 2 ? 2 : 1;
    const stageNum = S.stageMeta.stage;
    const isFinal = stageNum >= CONFIG.maxStage;
    await saveProgress({ stage: stageNum, hp: S.playerHp, cleared: true, stars, mobIndex: 0 });
    if (isFinal) {
      showVictory();
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
    await saveProgress({ stage: stageNum, hp: 0, cleared: false, mobIndex: 0 });
    showOverlay({
      emoji: '😴', title: 'Hiệp sĩ cần nghỉ ngơi', stars: -1,
      text: 'Hết máu rồi! Nghỉ một chút rồi thử lại ải này nhé — tiến trình các ải đã qua vẫn được giữ.',
      actions: [
        { label: '🔄 Thử lại ải này', primary: true, fn: () => startStage(stageNum) },
        { label: '🗺️ Bản đồ', primary: false, fn: enterMap },
      ],
    });
  }

  async function saveProgress(payload, silent) {
    const r = await postJson('/games/hiep-si/progress', Object.assign({ characterId: S.character.id }, payload), { silent: !!silent });
    if (r.ok && r.data.character) {
      S.character = r.data.character;
      const i = S.characters.findIndex((x) => x.id === r.data.character.id);
      if (i >= 0) S.characters[i] = r.data.character;
    } else if (r.network) {
      showNet('⚠️ Chưa lưu được tiến trình — hãy kiểm tra/đổi mạng.');
      setTimeout(hideNet, 2600);
    }
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
  function hideOverlay() {
    const ov = $('[data-overlay]');
    ov.classList.add('hidden');
    ov.classList.remove('knight-overlay-victory');
  }

  // Cảnh chiến thắng: pháo hoa + hoàng tử bế công chúa ăn mừng.
  function showVictory() {
    const heroIsGirl = S.character && S.character.gender === 'girl';
    // Hoàng tử bế công chúa (nếu bé là bạn gái thì công chúa được hoàng tử đón).
    $('[data-overlay-emoji]').innerHTML = '<span class="knight-royal">🤴</span><span class="knight-royal-heart">💞</span><span class="knight-royal knight-royal-b">👸</span>';
    $('[data-overlay-title]').textContent = '🎆 CỨU ĐƯỢC CÔNG CHÚA! 🎆';
    $('[data-overlay-stars]').textContent = '⭐⭐⭐';
    $('[data-overlay-text]').textContent = 'Hoàng tử bế công chúa ăn mừng! Hiệp sĩ ' + (S.character ? S.character.name : '') + ' đã thắng và cứu được ' + (heroIsGirl ? 'hoàng tử' : 'công chúa') + '! 👑';
    const actions = $('[data-overlay-actions]');
    actions.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'knight-btn knight-btn-primary';
    btn.textContent = '🗺️ Về bản đồ';
    btn.addEventListener('click', () => { hideOverlay(); enterMap(); });
    actions.appendChild(btn);
    const ov = $('[data-overlay]');
    ov.classList.add('knight-overlay-victory');
    ov.classList.remove('hidden');
    launchFireworks(8);
    let bursts = 0;
    const ci = setInterval(() => { confetti(); if (++bursts >= 5) clearInterval(ci); }, 650);
  }

  function launchFireworks(times) {
    const emojis = ['🎆', '🎇', '✨', '💥', '🌟'];
    let n = 0;
    const iv = setInterval(() => {
      for (let i = 0; i < 5; i++) {
        const s = document.createElement('span');
        s.className = 'knight-firework';
        s.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        s.style.left = (8 + Math.random() * 84) + 'vw';
        s.style.top = (8 + Math.random() * 55) + 'vh';
        s.style.animationDelay = (Math.random() * 0.25) + 's';
        document.body.appendChild(s);
        setTimeout(() => s.remove(), 1400);
      }
      if (++n >= times) clearInterval(iv);
    }, 550);
  }

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
