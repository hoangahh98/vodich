/**
 * Chuyển động trang trí của giao diện — chỉ chạy khi máy cho phép (prefers-reduced-motion).
 *
 *  1. Thẻ nghiêng theo con trỏ (.module-card, .game-card): đặt --rx/--ry, CSS lo phần
 *     perspective/rotate. Chỉ bật với chuột (hover + pointer fine), trên điện thoại vô nghĩa.
 *  2. Lộ dần khi cuộn tới: phần tử nằm dưới màn hình lúc mở trang được gắn .reveal, tới lúc
 *     lọt vào khung nhìn thì thêm .in. Xong transition là gỡ cả hai lớp để không đè lên
 *     transform riêng của thẻ (tilt, hover).
 *  3. Đếm số cho ô số liệu (.metric-card strong): 0 → giá trị thật trong ~.9s.
 *  4. Số điểm nảy nhẹ mỗi khi đổi (bảng tỉ số realtime, màn ghi điểm, đọc điểm).
 *
 * Không đụng tới dữ liệu, không gọi mạng; hỏng chỗ nào thì trang vẫn dùng bình thường.
 */
(() => {
  const media = (query) => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const reduceMotion = media('(prefers-reduced-motion: reduce)');
  if (reduceMotion) return;

  // 1. Thẻ nghiêng theo con trỏ
  if (media('(hover: hover) and (pointer: fine)')) {
    document.querySelectorAll('.module-card, .game-card').forEach((card) => {
      let frame = 0;
      card.addEventListener('pointermove', (event) => {
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          card.classList.add('tilting');
          card.style.setProperty('--ry', `${(px * 10).toFixed(2)}deg`);
          card.style.setProperty('--rx', `${(-py * 8).toFixed(2)}deg`);
        });
      });
      card.addEventListener('pointerleave', () => {
        window.cancelAnimationFrame(frame);
        card.classList.remove('tilting');
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  // 2. Lộ dần khi cuộn tới
  if ('IntersectionObserver' in window) {
    const viewportHeight = window.innerHeight || 0;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        observer.unobserve(el);
        el.classList.add('in');
        const done = () => el.classList.remove('reveal', 'in');
        el.addEventListener('transitionend', done, { once: true });
        window.setTimeout(done, 900);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    const pending = [];
    document
      .querySelectorAll('.module-card, .metric-card, .tran-card, .game-card, .ranking-board, .group-board, .cost-card, .permission-admin-card')
      .forEach((el) => {
        if (el.getBoundingClientRect().top < viewportHeight) return; // đang trong màn hình: khối cha đã có hiệu ứng nổi lên
        el.classList.add('reveal');
        observer.observe(el);
        pending.push(el);
      });
    // Lưới an toàn: hiệu ứng chỉ là trang trí, không được để nội dung ẩn mãi nếu observer không bắn
    // (in trang, trình duyệt lạ, khối bị cuộn trong khung riêng…).
    window.setTimeout(() => {
      pending.forEach((el) => {
        if (!el.classList.contains('reveal')) return;
        observer.unobserve(el);
        el.classList.remove('reveal', 'in');
      });
    }, 6000);
  }

  // 3. Đếm số cho ô số liệu
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  document.querySelectorAll('.metric-card strong').forEach((el) => {
    const text = (el.textContent || '').trim();
    const match = /^([\d.,]+)(.*)$/.exec(text);
    if (!match) return;
    const digits = match[1].replace(/[^\d]/g, '');
    const target = Number(digits);
    if (!digits || !Number.isFinite(target) || target === 0 || target > 1e15) return;
    const grouped = match[1].includes(',');
    const suffix = match[2];
    const duration = 900;
    const start = performance.now();
    const format = (value) => (grouped ? Math.round(value).toLocaleString('en-US') : String(Math.round(value)));
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      el.textContent = format(target * easeOut(progress)) + suffix;
      if (progress < 1) window.requestAnimationFrame(tick);
      else el.textContent = text;
    };
    el.textContent = format(0) + suffix;
    window.requestAnimationFrame(tick);
  });

  // 4. Số điểm nảy khi đổi
  if ('MutationObserver' in window) {
    const pop = (el) => {
      el.classList.remove('pop');
      void el.offsetWidth; // ép trình duyệt tính lại để animation chạy lại từ đầu
      el.classList.add('pop');
    };
    const scoreObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        const el = record.target instanceof Element ? record.target : record.target.parentElement;
        const host = el?.closest('.live-score-number, .score-reader-value, .score-pill');
        if (host) pop(host);
      });
    });
    document.querySelectorAll('.live-score-number, .score-reader-value, .score-pill').forEach((el) => {
      scoreObserver.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }
})();
