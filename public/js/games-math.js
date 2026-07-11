(() => {
  const stage = document.querySelector('[data-game="math"]');
  if (!stage) return;
  const { sound, praise, encourage, shuffle, confetti, Hud } = window.GameCore;
  const hud = new Hud(stage, 'game-math-best');

  const visualEl = stage.querySelector('[data-visual]');
  const questionEl = stage.querySelector('[data-question]');
  const choicesEl = stage.querySelector('[data-choices]');
  const feedbackEl = stage.querySelector('[data-feedback]');
  let level = 'easy';
  let current = null;
  let locked = false;

  const FRUITS = ['🍎', '🍌', '🍓', '🍊', '🍇', '🐢', '⭐', '🎈', '🐥'];

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function makeQuestion() {
    let a;
    let b;
    let op;
    if (level === 'easy') {
      op = Math.random() < 0.5 ? '+' : '-';
      a = rand(1, 10);
      b = rand(1, 10);
      if (op === '-' && b > a) [a, b] = [b, a];
    } else if (level === 'medium') {
      const r = Math.random();
      op = r < 0.4 ? '+' : r < 0.8 ? '-' : '×';
      if (op === '×') {
        a = rand(2, 5);
        b = rand(2, 5);
      } else {
        a = rand(1, 20);
        b = rand(1, 20);
        if (op === '-' && b > a) [a, b] = [b, a];
      }
    } else {
      const r = Math.random();
      op = r < 0.35 ? '+' : r < 0.7 ? '-' : '×';
      if (op === '×') {
        a = rand(2, 10);
        b = rand(2, 10);
      } else {
        a = rand(10, 99);
        b = rand(1, 99);
        if (op === '-' && b > a) [a, b] = [b, a];
      }
    }
    const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
    return { a, b, op, answer };
  }

  function distractors(answer) {
    const set = new Set([answer]);
    while (set.size < 4) {
      const delta = rand(1, Math.max(3, Math.round(Math.abs(answer) * 0.3) + 2));
      const candidate = answer + (Math.random() < 0.5 ? -delta : delta);
      if (candidate >= 0) set.add(candidate);
    }
    return shuffle([...set]);
  }

  function renderVisual(q) {
    // Minh hoạ bằng emoji cho phép cộng/trừ nhỏ để bé dễ hình dung.
    if (q.op === '×' || q.a > 12 || q.b > 12) {
      visualEl.textContent = '🧮';
      return;
    }
    const fruit = window.GameCore.pick(FRUITS);
    if (q.op === '+') {
      visualEl.innerHTML = `<span>${fruit.repeat(q.a)}</span><b>+</b><span>${fruit.repeat(q.b)}</span>`;
    } else {
      const kept = fruit.repeat(q.a - q.b);
      const gone = `<s>${fruit.repeat(q.b)}</s>`;
      visualEl.innerHTML = `<span>${kept}${gone}</span>`;
    }
  }

  function next() {
    locked = false;
    feedbackEl.textContent = '';
    feedbackEl.className = 'game-feedback';
    current = makeQuestion();
    renderVisual(current);
    questionEl.textContent = `${current.a} ${current.op} ${current.b} = ?`;
    choicesEl.innerHTML = '';
    distractors(current.answer).forEach((value) => {
      const btn = document.createElement('button');
      btn.className = 'game-choice';
      btn.textContent = value;
      btn.addEventListener('click', () => choose(btn, value));
      choicesEl.appendChild(btn);
    });
  }

  function choose(btn, value) {
    if (locked) return;
    locked = true;
    if (value === current.answer) {
      btn.classList.add('correct');
      sound('correct');
      hud.correct();
      if (hud.streak > 0 && hud.streak % 5 === 0) {
        confetti();
        sound('win');
      }
      feedbackEl.textContent = praise();
      feedbackEl.className = 'game-feedback good';
      setTimeout(next, 900);
    } else {
      btn.classList.add('wrong');
      sound('wrong');
      hud.wrong();
      feedbackEl.textContent = `${encourage()} Đáp án đúng là ${current.answer}.`;
      feedbackEl.className = 'game-feedback bad';
      choicesEl.querySelectorAll('.game-choice').forEach((el) => {
        if (Number(el.textContent) === current.answer) el.classList.add('correct');
      });
      setTimeout(next, 1600);
    }
  }

  stage.querySelector('[data-levels]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-level]');
    if (!button) return;
    level = button.getAttribute('data-level');
    stage.querySelectorAll('.game-level').forEach((el) => el.classList.toggle('active', el === button));
    next();
  });

  next();
})();
