const assert = require('node:assert/strict');
const test = require('node:test');
const { Prisma } = require('@prisma/client');

const { ORDER, assertOrderCoversSchema } = require('../scripts/restore-db');

/**
 * Bảo vệ đường KHÔI PHỤC — thứ chỉ được dùng đúng một lần, vào lúc tệ nhất.
 *
 * CA THẬT (28/7/2026): danh sách ORDER thiếu 13 bảng (toàn bộ module y tế, chi tiêu và game
 * Hiệp Sĩ). Backup vẫn có dữ liệu, nhưng restore chỉ chạy theo ORDER nên bỏ qua IM LẶNG —
 * khôi phục xong sẽ trông như thành công trong khi bệnh án và sổ chi tiêu đã mất sạch.
 * Không ai phát hiện được cho tới đúng lúc cần nó.
 */

const MODELS = Prisma.dmmf.datamodel.models;

test('restore phải phủ HẾT bảng trong schema — thêm bảng mới mà quên khai là gãy ngay', () => {
  assert.doesNotThrow(() => assertOrderCoversSchema());
  assert.equal(ORDER.length, MODELS.length, 'số bảng trong ORDER phải bằng số model của schema');
});

test('ORDER không có bảng trùng lặp', () => {
  assert.equal(new Set(ORDER).size, ORDER.length);
});

/**
 * Khoá ngoại chỉ trỏ về bảng đã chèn trước đó, nếu không Postgres từ chối ngay.
 *
 * Hiện KHÔNG còn khoá vòng nào (cái duy nhất là TravelTrip.treasurerMemberId, đã đi cùng
 * module du lịch ngày 3/8/2026). Giữ lại tập rỗng chứ không xoá hẳn: thêm khoá vòng mới thì
 * khai vào đây, kèm cách script phá vòng — chứ đừng nới lỏng phép kiểm.
 */
const KNOWN_CYCLES = new Set([]);

test('ORDER xếp cha trước con theo đúng khoá ngoại', () => {
  const position = new Map(ORDER.map((name, index) => [name, index]));
  const problems = [];

  for (const model of MODELS) {
    for (const field of model.fields) {
      if (field.kind !== 'object' || !field.relationFromFields?.length) continue;
      const target = field.type;
      if (target === model.name) continue; // tự tham chiếu, không phải vấn đề thứ tự
      if (KNOWN_CYCLES.has(`${model.name}.${field.relationFromFields[0]}`)) continue;
      if (position.get(target) > position.get(model.name)) {
        problems.push(`${model.name} (vị trí ${position.get(model.name)}) cần ${target} (vị trí ${position.get(target)}) có trước`);
      }
    }
  }

  assert.deepEqual(problems, [], `Thứ tự chèn sai, khôi phục sẽ lỗi khoá ngoại:\n  ${problems.join('\n  ')}`);
});

test('mọi bảng có id tự tăng đều được đặt lại bộ đếm sau khi khôi phục', () => {
  // Không đặt lại thì DB khôi phục xong trông vẫn ổn, nhưng bản ghi MỚI đầu tiên sẽ lấy
  // id = 1 và đâm vào id đã có -> lỗi trùng khoá chính vài phút sau khi khôi phục.
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'scripts', 'restore-db.js'), 'utf8');
  assert.match(source, /setval\(pg_get_serial_sequence/, 'restore phải đặt lại bộ đếm id');
  assert.match(source, /autoincrement/, 'phải quét đúng các bảng có id tự tăng');
});

test('backup đổi tên cột DB về tên field Prisma khi phải đọc bằng SQL thô', () => {
  // Không đổi thì file backup lẫn hai dạng khoá và restore chết với
  // "Unknown argument `week_start_dow`" — đúng lúc đang cần khôi phục.
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'scripts', 'backup-db.js'), 'utf8');
  assert.match(source, /fieldByColumn/, 'rawRows phải map tên cột DB sang tên field Prisma');
});
