-- Quỹ du lịch chuyển từ "một dòng chi được ghi ra" sang "số TỰ TÍNH".
--
-- Bản trước, mỗi lần khoản cố định chi hụt thì sinh một khoản chi vào loại "Tiết kiệm du lịch".
-- Chủ sổ chốt bỏ cách đó (31/7/2026): quỹ này kế thừa từ RẤT NHIỀU khoản cố định, ghi thành
-- một dòng thì dòng đó vừa lẫn vào danh sách khoản chi vừa sửa được — sửa xong là lệch khỏi
-- các khoản đã sinh ra nó và không còn cách nào biết số nào đúng.
--
-- Nay số đó suy thẳng ra từ `planned_amount - amount` của các khoản cố định. Các dòng đã tự
-- sinh phải xoá đi, nếu không phần dư bị đếm HAI lần (một lần ở dòng cũ, một lần ở số suy ra).
--
-- Điều kiện xoá bám rất chặt để không đụng dòng nào do người dùng tự gõ: đúng ghi chú máy đặt
-- ra, VÀ thuộc loại tên "Tiết kiệm du lịch", VÀ không có mức dự kiến (dòng tự sinh luôn = 0).
DELETE FROM "household_expense" e
 USING "household_expense_category" c
 WHERE c."id" = e."category_id"
   AND lower(btrim(c."name")) = 'tiết kiệm du lịch'
   AND e."note" LIKE 'Dư từ khoản cố định ngày %'
   AND e."planned_amount" = 0;

-- Loại đó giờ là nơi khai TIỀN TIÊU cho du lịch (một khoản chi bình thường), không phải chỗ
-- cất tiền — nếu để kiểu `saving` thì tiêu vào nó lại làm số tiết kiệm phồng lên.
UPDATE "household_expense_category"
   SET "kind" = 'variable',
       "note" = 'Khai tiền TIÊU cho du lịch ở đây; phần dư của khoản cố định tự cộng vào ô Còn du lịch'
 WHERE lower(btrim("name")) = 'tiết kiệm du lịch' AND "kind" = 'saving';
