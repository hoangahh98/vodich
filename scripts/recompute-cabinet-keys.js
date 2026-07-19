/**
 * Tính lại match_key cho tủ thuốc sau khi đổi thuật toán trong src/medical/cabinet.ts.
 *
 * PHẢI CHẠY MỘT LẦN khi đổi matchKey(), nếu không những dòng cũ mang khoá kiểu cũ sẽ
 * thành mồ côi: không bao giờ khớp với đơn thuốc nữa, và người dùng chỉ thấy phần "nhà
 * đang có sẵn" lặng lẽ ngừng hoạt động chứ không có lỗi nào báo ra.
 *
 * Chạy:  node scripts/recompute-cabinet-keys.js
 * An toàn để chạy lại nhiều lần: chỉ ghi những dòng có khoá lệch.
 */
const { PrismaClient } = require('@prisma/client');
const { matchKey } = require('../dist/medical/cabinet');

const prisma = new PrismaClient();

(async () => {
  const items = await prisma.medCabinetItem.findMany({ select: { id: true, drugName: true, matchKey: true } });
  let changed = 0;
  for (const item of items) {
    const next = matchKey(item.drugName);
    if (next === item.matchKey) continue;
    await prisma.medCabinetItem.update({ where: { id: item.id }, data: { matchKey: next } });
    console.log(`  #${item.id} ${item.drugName}\n     ${item.matchKey} -> ${next}`);
    changed++;
  }
  console.log(`\nĐã soát ${items.length} dòng, cập nhật ${changed}.`);
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
