/**
 * Bánh xe quay tên (kiểu wheelofnames.com) — THUẦN VẼ + QUAY, không biết gì về giải đấu.
 *
 * Dùng chung cho hai chỗ:
 *   - public/js/spin-draw.js      — vòng quay chia đội trong giải (luật bốc ở spin-pairing.js)
 *   - public/js/wheel-of-names.js — trang vòng quay đứng riêng ở /vong-quay
 *
 * Nguyên tắc: NGƯỜI TRÚNG DO BÊN GỌI QUYẾT ĐỊNH, bánh xe chỉ tính góc dừng sao cho múi của
 * người đó nằm đúng dưới kim. Làm ngược lại (quay bừa rồi đọc xem trúng ai) thì vòng quay tự
 * bốc theo luật riêng, lệch hẳn với luật chia đội ở server.
 *
 * Góc quy ước: ĐỘ, theo chiều kim đồng hồ, 0° là đúng 12 giờ — chỗ cắm kim.
 */
(() => {
  /** Bảng màu múi: đủ tương phản với chữ trắng, lặp vòng khi đông người. */
  const COLORS = ['#2f6fed', '#e8453c', '#f2a43a', '#1f9d55', '#8b5cf6', '#0e9fb4', '#ef5da8', '#5b6b7f'];
  const TURNS = 6;

  const escapeHtml = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const reducedMotion = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** Điểm trên vành ở góc `deg`, bán kính `radius` (hệ toạ độ viewBox 0 0 100 100). */
  function rimPoint(deg, radius) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(50 + radius * Math.cos(rad)).toFixed(3)} ${(50 + radius * Math.sin(rad)).toFixed(3)}`;
  }

  /** Màu múi i, có né trường hợp múi cuối đụng múi đầu khi số múi vừa đúng bội bảng màu. */
  function sliceColor(index, count) {
    if (count > 1 && index === count - 1 && index % COLORS.length === 0) return COLORS[1];
    return COLORS[index % COLORS.length];
  }

  /** Cỡ chữ theo số múi: đông người thì chữ phải nhỏ lại, nếu không các múi đè chữ lên nhau. */
  const fontSizeFor = (count) => Math.max(2.4, Math.min(6.4, 30 / Math.max(count, 1) + 2.2));

  /** Cắt tên cho vừa bán kính múi — tên dài quá thì chữ tràn khỏi vành, đọc còn tệ hơn. */
  function fitName(name, fontSize) {
    const maxChars = Math.max(5, Math.floor(34 / (fontSize * 0.55)));
    const text = String(name == null ? '' : name);
    return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
  }

  /** Dựng SVG bánh xe cho danh sách tên. Tách riêng để test được mà không cần trình duyệt. */
  function wheelSvg(names) {
    const count = names.length;
    const fontSize = fontSizeFor(count);

    /**
     * Nhãn tên trên múi có tâm ở góc `centerDeg`.
     *
     * Chữ chạy dọc theo bán kính. Múi nằm ở NỬA TRÁI bánh xe thì phải lật 180° và neo từ đầu
     * kia, nếu không tên bị dựng ngược đầu — quay xong nhìn thấy chữ lộn ngược thì đọc không ra.
     */
    const label = (name, centerDeg) => {
      const straight = (((centerDeg - 90) % 360) + 360) % 360;
      const flipped = straight > 90 && straight < 270;
      const angle = flipped ? straight - 180 : straight;
      return `<g transform="rotate(${angle.toFixed(3)} 50 50)"><text x="${flipped ? 7 : 93}" y="50" text-anchor="${flipped ? 'start' : 'end'}" dominant-baseline="central" font-size="${fontSize.toFixed(2)}">${escapeHtml(fitName(name, fontSize))}</text></g>`;
    };

    let inner = '';
    if (!count) {
      inner = '<circle cx="50" cy="50" r="46" fill="#94a3b8"></circle>';
    } else if (count === 1) {
      // Một tên thì không có múi để chạy dọc bán kính: đặt luôn giữa bánh xe cho dễ đọc.
      inner = `<circle cx="50" cy="50" r="46" fill="${COLORS[0]}"></circle><text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="${fontSize.toFixed(2)}">${escapeHtml(fitName(names[0], fontSize))}</text>`;
    } else {
      const seg = 360 / count;
      for (let index = 0; index < count; index++) {
        const start = index * seg;
        inner += `<path d="M50 50 L${rimPoint(start, 46)} A46 46 0 ${seg > 180 ? 1 : 0} 1 ${rimPoint(start + seg, 46)} Z" fill="${sliceColor(index, count)}"></path>`;
      }
      // Vẽ chữ sau toàn bộ múi, nếu không múi sau sẽ đè lên chữ của múi trước.
      for (let index = 0; index < count; index++) inner += label(names[index], (index + 0.5) * seg);
    }
    return `<svg viewBox="0 0 100 100" class="wheel-svg" aria-hidden="true"><g class="wheel-slices">${inner}</g><circle cx="50" cy="50" r="46" class="wheel-rim"></circle></svg>`;
  }

  /**
   * Gắn bánh xe vào một phần tử "rotor" (chính phần tử được xoay bằng CSS transform).
   * Góc cộng dồn nên bánh xe luôn quay tới, không bao giờ giật ngược.
   */
  function attach(rotor, options) {
    const settings = options || {};
    const reduced = reducedMotion();
    const spinMs = reduced ? 260 : Number(settings.spinMs || 3600);
    let rotation = 0;
    let names = [];

    return {
      names: () => names,

      render(list) {
        names = [...(list || [])];
        rotor.innerHTML = wheelSvg(names);
        return names;
      },

      /** Về vị trí 0° không hoạt ảnh — dùng khi làm lại từ đầu. */
      reset() {
        rotation = 0;
        rotor.style.transition = 'none';
        rotor.style.transform = 'rotate(0deg)';
      },

      /** Quay cho múi `index` dừng dưới kim. Trả Promise xong khi hoạt ảnh kết thúc. */
      async spinTo(index) {
        const count = Math.max(names.length, 1);
        const seg = 360 / count;
        const center = (Math.max(0, index) + 0.5) * seg;
        // Lệch nhẹ trong lòng múi cho đỡ máy móc, nhưng vẫn phải nằm gọn trong múi đó.
        const jitter = (Math.random() - 0.5) * seg * 0.55;
        const current = ((rotation % 360) + 360) % 360;
        const target = (((-center + jitter) % 360) + 360) % 360;
        rotation += ((target - current + 360) % 360) + 360 * TURNS;

        rotor.style.transition = `transform ${spinMs}ms cubic-bezier(.16,.68,.12,1)`;
        rotor.style.transform = `rotate(${rotation}deg)`;
        await wait(spinMs + 60);
      },
    };
  }

  const api = { attach, wheelSvg, fitName, fontSizeFor, sliceColor, reducedMotion, COLORS };
  if (typeof window !== 'undefined') window.VodichWheel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
