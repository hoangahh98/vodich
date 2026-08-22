const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

/**
 * Bánh xe quay tên (public/js/wheel.js).
 *
 * Chỗ dễ sai nhất là DẤU của góc: quay thuận hay nghịch kim đồng hồ, kim cắm ở 12 giờ hay 3
 * giờ. Sai dấu thì bánh xe vẫn quay đẹp, vẫn dừng gọn trong một múi — chỉ có điều dừng ở múi
 * của người KHÁC, mà nhìn giao diện không tài nào phát hiện ra. Nên phải kiểm bằng số học:
 * quay tới múi i xong thì tâm múi i phải nằm dưới kim.
 */
const root = path.join(__dirname, '..');

/** Dựng một realm giả lập trình duyệt vừa đủ cho wheel.js: không DOM thật, không chờ thật. */
function loadWheel() {
  const context = {
    window: {
      // Chờ ngay lập tức: bài test không việc gì phải ngồi đợi 3,4 giây hoạt ảnh.
      setTimeout: (fn) => setTimeout(fn, 0),
      matchMedia: () => ({ matches: false }),
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/wheel.js'), 'utf8'), context);
  return context.window.VodichWheel;
}

const wheelKit = loadWheel();

/** Rotor giả: chỉ cần hứng innerHTML và style.transform như một phần tử DOM thật. */
const fakeRotor = () => ({ innerHTML: '', style: {} });

const rotationOf = (rotor) => Number(/rotate\((-?[\d.]+)deg\)/.exec(rotor.style.transform)[1]);

test('bánh xe vẽ đủ số múi và đủ số nhãn tên', () => {
  for (const count of [2, 3, 5, 8, 17]) {
    const names = Array.from({ length: count }, (_, index) => `Người ${index}`);
    const svg = wheelKit.wheelSvg(names);
    assert.equal((svg.match(/<path /g) || []).length, count, `${count} tên phải ra ${count} múi`);
    assert.equal((svg.match(/<text /g) || []).length, count, `${count} tên phải ra ${count} nhãn`);
  }
});

test('một tên thì vẽ hình tròn liền, không tên thì không nổ', () => {
  const single = wheelKit.wheelSvg(['Một mình']);
  assert.doesNotMatch(single, /<path /, 'một tên thì không cần cắt múi');
  assert.match(single, /Một mình/);
  assert.doesNotThrow(() => wheelKit.wheelSvg([]));
});

test('tên người là dữ liệu, không phải HTML', () => {
  const svg = wheelKit.wheelSvg(['<script>x</script>']);
  assert.doesNotMatch(svg, /<script>/, 'tên chứa thẻ phải bị escape trước khi vào SVG');
  assert.match(svg, /&lt;script/);
});

test('tên dài bị cắt cho vừa múi, tên ngắn giữ nguyên', () => {
  assert.equal(wheelKit.fitName('An', 6), 'An');
  const long = wheelKit.fitName('Nguyễn Khắc Hoàng Anh Rất Dài', 6);
  assert.ok(long.length < 'Nguyễn Khắc Hoàng Anh Rất Dài'.length, 'tên dài phải bị cắt');
  assert.ok(long.endsWith('…'), 'cắt rồi phải có dấu … cho biết là còn nữa');
});

test('đông người thì chữ nhỏ lại, ít người thì chữ to hơn', () => {
  assert.ok(wheelKit.fontSizeFor(3) > wheelKit.fontSizeFor(30), 'chữ phải co theo số múi');
  assert.ok(wheelKit.fontSizeFor(200) >= 2.4, 'nhưng không được nhỏ tới mức tàng hình');
});

test('múi cuối không trùng màu múi đầu khi số múi vừa đúng bội bảng màu', () => {
  const count = wheelKit.COLORS.length;
  assert.notEqual(wheelKit.sliceColor(count - 1, count), wheelKit.sliceColor(0, count));
});

/** Tâm múi `index` sau khi quay `rotation` độ, quy về khoảng (-180, 180] so với kim ở 12 giờ. */
function offsetFromPointer(index, count, rotation) {
  const seg = 360 / count;
  const landed = (((index + 0.5) * seg + rotation) % 360 + 360) % 360;
  return landed > 180 ? landed - 360 : landed;
}

test('quay tới múi nào thì múi đó dừng dưới kim', async () => {
  for (const count of [2, 4, 5, 9, 12]) {
    const rotor = fakeRotor();
    const wheel = wheelKit.attach(rotor, { spinMs: 1 });
    wheel.render(Array.from({ length: count }, (_, index) => `P${index}`));
    for (let index = 0; index < count; index++) {
      await wheel.spinTo(index);
      const offset = offsetFromPointer(index, count, rotationOf(rotor));
      assert.ok(
        Math.abs(offset) < 360 / count / 2,
        `${count} múi: quay tới múi ${index} mà kim lệch ${offset.toFixed(1)}° — ra ngoài múi`,
      );
    }
  }
});

test('bánh xe luôn quay TỚI, không bao giờ giật ngược', async () => {
  const rotor = fakeRotor();
  const wheel = wheelKit.attach(rotor, { spinMs: 1 });
  wheel.render(['A', 'B', 'C', 'D', 'E']);
  let previous = 0;
  for (const index of [3, 0, 4, 1, 1, 2]) {
    await wheel.spinTo(index);
    const now = rotationOf(rotor);
    assert.ok(now > previous, `góc phải tăng dần, đang ${previous} lại nhảy về ${now}`);
    // Ít nhất vài vòng mỗi lượt, nếu không nhìn như bánh xe chỉ nhích một cái rồi thôi.
    assert.ok(now - previous > 360 * 3, 'mỗi lượt phải quay ít nhất mấy vòng cho ra dáng');
    previous = now;
  }
});

test('quay lại cùng một múi hai lần vẫn phải quay thêm trọn vòng', async () => {
  const rotor = fakeRotor();
  const wheel = wheelKit.attach(rotor, { spinMs: 1 });
  wheel.render(['A', 'B']);
  await wheel.spinTo(0);
  const first = rotationOf(rotor);
  await wheel.spinTo(0);
  assert.ok(rotationOf(rotor) - first > 360 * 3, 'trúng lại chính múi cũ không được đứng im');
});

test('làm lại thì bánh xe về mốc 0 và bỏ hoạt ảnh', async () => {
  const rotor = fakeRotor();
  const wheel = wheelKit.attach(rotor, { spinMs: 1 });
  wheel.render(['A', 'B', 'C']);
  await wheel.spinTo(2);
  wheel.reset();
  assert.equal(rotor.style.transform, 'rotate(0deg)');
  assert.equal(rotor.style.transition, 'none', 'về mốc mà còn hoạt ảnh thì thấy nó quay ngược');
});

test('render trả về đúng danh sách đang nằm trên bánh xe', () => {
  const wheel = wheelKit.attach(fakeRotor(), { spinMs: 1 });
  // `vm.runInNewContext` dựng realm riêng nên mảng trả về khác prototype: so bản thuần.
  const names = () => JSON.parse(JSON.stringify(wheel.names()));
  wheel.render(['A', 'B']);
  assert.deepEqual(names(), ['A', 'B']);
  wheel.render(['C']);
  assert.deepEqual(names(), ['C']);
});

/**
 * Chữ trên múi chạy dọc bán kính, nên múi ở nửa TRÁI bánh xe phải được lật 180° và neo từ đầu
 * kia. Không lật thì nửa bánh xe hiện tên lộn ngược đầu — quay đẹp nhưng đọc không ra.
 */
test('không tên nào bị dựng ngược đầu, kể cả nửa trái bánh xe', () => {
  for (const count of [2, 3, 4, 6, 7, 12]) {
    const svg = wheelKit.wheelSvg(Array.from({ length: count }, (_, index) => `P${index}`));
    const angles = [...svg.matchAll(/rotate\((-?[\d.]+) 50 50\)/g)].map((match) => Number(match[1]));
    assert.equal(angles.length, count, `${count} múi phải có ${count} nhãn`);
    for (const angle of angles) {
      const normalized = ((((angle % 360) + 540) % 360) - 180);
      assert.ok(Math.abs(normalized) <= 90.001, `${count} múi: nhãn xoay ${angle}° là chữ nằm ngược`);
    }
  }
});

test('một tên duy nhất thì đặt giữa bánh xe, không xoay lung tung', () => {
  const svg = wheelKit.wheelSvg(['Một mình']);
  assert.doesNotMatch(svg, /rotate\(/, 'một tên thì không cần xoay nhãn');
  assert.match(svg, /text-anchor="middle"/);
});
