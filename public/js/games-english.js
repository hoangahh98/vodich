(() => {
  const stage = document.querySelector('[data-game="english"]');
  if (!stage) return;
  const { sound, speak, praise, encourage, pick, shuffle, confetti, Hud } = window.GameCore;
  const hud = new Hud(stage, 'game-english-best');

  const WORDS = {
    animals: [
      { e: '🐶', w: 'dog', v: 'con chó' }, { e: '🐱', w: 'cat', v: 'con mèo' }, { e: '🐘', w: 'elephant', v: 'con voi' },
      { e: '🦁', w: 'lion', v: 'sư tử' }, { e: '🐟', w: 'fish', v: 'con cá' }, { e: '🐦', w: 'bird', v: 'con chim' },
      { e: '🐴', w: 'horse', v: 'con ngựa' }, { e: '🐮', w: 'cow', v: 'con bò' }, { e: '🐷', w: 'pig', v: 'con lợn' },
      { e: '🐵', w: 'monkey', v: 'con khỉ' }, { e: '🐸', w: 'frog', v: 'con ếch' }, { e: '🐰', w: 'rabbit', v: 'con thỏ' },
    ],
    fruits: [
      { e: '🍎', w: 'apple', v: 'quả táo' }, { e: '🍌', w: 'banana', v: 'quả chuối' }, { e: '🍊', w: 'orange', v: 'quả cam' },
      { e: '🍇', w: 'grapes', v: 'chùm nho' }, { e: '🍓', w: 'strawberry', v: 'quả dâu' }, { e: '🍉', w: 'watermelon', v: 'dưa hấu' },
      { e: '🍍', w: 'pineapple', v: 'quả dứa' }, { e: '🥭', w: 'mango', v: 'quả xoài' }, { e: '🍑', w: 'peach', v: 'quả đào' },
    ],
    colors: [
      { e: '🔴', w: 'red', v: 'màu đỏ' }, { e: '🔵', w: 'blue', v: 'xanh dương' }, { e: '🟢', w: 'green', v: 'xanh lá' },
      { e: '🟡', w: 'yellow', v: 'màu vàng' }, { e: '🟣', w: 'purple', v: 'màu tím' }, { e: '🟠', w: 'orange', v: 'màu cam' },
      { e: '⚫', w: 'black', v: 'màu đen' }, { e: '⚪', w: 'white', v: 'màu trắng' }, { e: '🟤', w: 'brown', v: 'màu nâu' },
    ],
    things: [
      { e: '🚗', w: 'car', v: 'xe hơi' }, { e: '✈️', w: 'airplane', v: 'máy bay' }, { e: '🏠', w: 'house', v: 'ngôi nhà' },
      { e: '⚽', w: 'ball', v: 'quả bóng' }, { e: '📚', w: 'book', v: 'quyển sách' }, { e: '🌞', w: 'sun', v: 'mặt trời' },
      { e: '🌙', w: 'moon', v: 'mặt trăng' }, { e: '⭐', w: 'star', v: 'ngôi sao' }, { e: '🌳', w: 'tree', v: 'cái cây' },
      { e: '🚲', w: 'bicycle', v: 'xe đạp' }, { e: '☂️', w: 'umbrella', v: 'cái ô' }, { e: '🎈', w: 'balloon', v: 'bóng bay' },
    ],
  };

  const visualEl = stage.querySelector('[data-visual]');
  const speakBtn = stage.querySelector('[data-speak]');
  const questionEl = stage.querySelector('[data-question]');
  const choicesEl = stage.querySelector('[data-choices]');
  const feedbackEl = stage.querySelector('[data-feedback]');
  let category = 'all';
  let current = null;
  let mode = 'word'; // 'word' = nhìn hình chọn từ; 'listen' = nghe đọc chọn hình
  let locked = false;

  function pool() {
    if (category === 'all') return Object.values(WORDS).flat();
    return WORDS[category] || [];
  }

  function optionsFor(correct, list) {
    const set = [correct];
    const rest = shuffle(list.filter((item) => item.w !== correct.w));
    for (const item of rest) {
      if (set.length >= 4) break;
      set.push(item);
    }
    return shuffle(set);
  }

  function next() {
    locked = false;
    feedbackEl.textContent = '';
    feedbackEl.className = 'game-feedback';
    const list = pool();
    current = pick(list);
    mode = Math.random() < 0.5 ? 'word' : 'listen';
    choicesEl.innerHTML = '';
    const options = optionsFor(current, list);

    if (mode === 'word') {
      visualEl.classList.remove('hidden');
      visualEl.textContent = current.e;
      questionEl.textContent = 'Đây là gì? Chọn từ tiếng Anh đúng nhé!';
      speakBtn.classList.add('hidden');
      options.forEach((item) => {
        const btn = document.createElement('button');
        btn.className = 'game-choice game-choice-word';
        btn.textContent = item.w;
        btn.addEventListener('click', () => choose(btn, item));
        choicesEl.appendChild(btn);
      });
    } else {
      visualEl.classList.add('hidden');
      questionEl.textContent = 'Nghe và chọn hình đúng 👂';
      speakBtn.classList.remove('hidden');
      speak(current.w);
      options.forEach((item) => {
        const btn = document.createElement('button');
        btn.className = 'game-choice game-choice-emoji';
        btn.textContent = item.e;
        btn.addEventListener('click', () => choose(btn, item));
        choicesEl.appendChild(btn);
      });
    }
  }

  function choose(btn, item) {
    if (locked) return;
    locked = true;
    if (item.w === current.w) {
      btn.classList.add('correct');
      sound('correct');
      speak(current.w);
      hud.correct();
      if (hud.streak > 0 && hud.streak % 5 === 0) {
        confetti();
        sound('win');
      }
      feedbackEl.textContent = `${praise()} ${current.e} = "${current.w}" (${current.v})`;
      feedbackEl.className = 'game-feedback good';
      setTimeout(next, 1300);
    } else {
      btn.classList.add('wrong');
      sound('wrong');
      hud.wrong();
      feedbackEl.textContent = `${encourage()} Đáp án: ${current.e} = "${current.w}" (${current.v})`;
      feedbackEl.className = 'game-feedback bad';
      choicesEl.querySelectorAll('.game-choice').forEach((el) => {
        if (el.textContent === current.w || el.textContent === current.e) el.classList.add('correct');
      });
      setTimeout(next, 1900);
    }
  }

  speakBtn.addEventListener('click', () => current && speak(current.w));
  stage.querySelector('[data-levels]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-cat]');
    if (!button) return;
    category = button.getAttribute('data-cat');
    stage.querySelectorAll('.game-level').forEach((el) => el.classList.toggle('active', el === button));
    next();
  });

  next();
})();
