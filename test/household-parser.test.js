const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseVpbankEmail,
  parseVndAmount,
  parseVpbankDate,
} = require('../dist/household/household-parser');

// Tái dựng đúng bố cục email VPBank trong ảnh mẫu (mau.png): bảng song ngữ, mỗi hàng
// gồm [nhãn VN][giá trị] xen kẽ, hàng dưới là nhãn tiếng Anh.
const SAMPLE_EMAIL = `
<html><body>
  <img src="vpbank-logo.png" alt="VPBank">
  <p>Kính gửi Khách hàng: <b>NGUYEN THI DIEN</b></p>
  <p>Dear Mr/Ms</p>
  <p>Ngân hàng Việt Nam Thịnh Vượng - VPBank xin trân trọng thông báo thông tin giao dịch.</p>
  <table>
    <tr><td>Mã giao dịch:</td><td>FT26199390280554/172247022673</td><td>Ngày, giờ giao dịch:</td><td>17/07/2026 22:18:59</td></tr>
    <tr><td>Transaction code</td><td></td><td>Transaction date, time</td><td></td></tr>
    <tr><td>Tài khoản trích nợ</td><td>0382079196</td><td>Số tiền trích nợ</td><td>50,000 VND</td></tr>
    <tr><td>Debit Account</td><td></td><td>Debit Amount</td><td></td></tr>
    <tr><td>Tài khoản ghi có:</td><td>0839773579</td><td>Số tiền ghi có:</td><td>50,000 VND</td></tr>
    <tr><td>Credit Account</td><td></td><td>Credit Amount</td><td></td></tr>
    <tr><td>Tên người hưởng:</td><td>NGUYEN KHAC HOANG ANH</td><td></td><td></td></tr>
    <tr><td>Beneficiary Name</td><td></td></tr>
    <tr><td>Loại phí:</td><td>Phí người chuyển trả</td><td>Số tiền phí:</td><td>0 VND</td></tr>
    <tr><td>Charge Code</td><td>Exclude</td><td>Fee Amount</td><td></td></tr>
    <tr><td>Nội dung chuyển tiền:</td><td>d25RQ8LLL9LDxcGjGc5xTGCID NGUYEN THI DIEN chuyen tien</td></tr>
    <tr><td>Details of Payment</td><td></td></tr>
  </table>
</body></html>`;

test('parseVndAmount xử lý mọi kiểu định dạng số tiền VND', () => {
  assert.equal(parseVndAmount('50,000 VND'), 50000);
  assert.equal(parseVndAmount('50.000'), 50000);
  assert.equal(parseVndAmount('1,050,000 VND'), 1050000);
  assert.equal(parseVndAmount('0 VND'), 0);
  assert.equal(parseVndAmount(''), 0);
});

test('parseVpbankDate đọc đúng dd/mm/yyyy HH:MM:SS', () => {
  const date = parseVpbankDate('17/07/2026 22:18:59');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 6); // tháng 7 (0-index)
  assert.equal(date.getDate(), 17);
  assert.equal(date.getHours(), 22);
  assert.equal(date.getMinutes(), 18);
  assert.equal(date.getSeconds(), 59);
  assert.equal(parseVpbankDate('không phải ngày'), null);
});

test('parseVpbankEmail trích xuất đầy đủ trường từ email mẫu VPBank', () => {
  const txn = parseVpbankEmail(SAMPLE_EMAIL);
  assert.ok(txn, 'phải parse được');
  assert.equal(txn.txnCode, 'FT26199390280554/172247022673');
  assert.equal(txn.amount, 50000);
  assert.equal(txn.debitAccount, '0382079196');
  assert.equal(txn.creditAccount, '0839773579');
  assert.equal(txn.performedBy, 'NGUYEN THI DIEN');
  assert.equal(txn.beneficiary, 'NGUYEN KHAC HOANG ANH');
  assert.equal(txn.fee, 0);
  assert.equal(txn.occurredAt.getFullYear(), 2026);
  assert.equal(txn.occurredAt.getDate(), 17);
  assert.match(txn.description, /chuyen tien/);
});

test('parseVpbankEmail bỏ qua email không phải VPBank', () => {
  assert.equal(parseVpbankEmail('<p>Thư quảng cáo bình thường</p>'), null);
});

test('parseVpbankEmail trả null khi thiếu số tiền trích nợ', () => {
  const noAmount = SAMPLE_EMAIL.replace('50,000 VND', '').replace('Số tiền trích nợ', 'Số tiền khác');
  assert.equal(parseVpbankEmail(noAmount), null);
});
