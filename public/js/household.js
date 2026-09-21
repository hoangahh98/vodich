/**
 * Form giao dịch / khoản định kỳ của module Chi tiêu. Không có inline script vì CSP script-src 'self'.
 *
 * Ô "Loại" có năm lựa chọn (chủ app 21/9/2026); ba cái cuối đều là chuyển tiền sang nguồn khác nên
 * server ghi TRANSFER, khác nhau ở LOẠI NGUỒN ĐÍCH được phép chọn:
 *
 *   Chi / Thu  -> không có "Sang nguồn", có ô Mục đích, một ô Số tiền.
 *   Trả nợ     -> sang thẻ hoặc khoản vay. KHÔNG có ô Số tiền: gõ Trả gốc và Trả lãi, tổng tự cộng.
 *   Đầu tư     -> sang nguồn đầu tư. Một ô Số tiền.
 *   Cho vay    -> sang nguồn cho vay. Một ô Số tiền.
 *
 * Ba loại chuyển đều KHÔNG hỏi mục đích. Ô giấu bằng `hidden` VẪN gửi giá trị lên, nên server cũng
 * tự bỏ mục đích/lãi chứ không tin form.
 */
(() => {
  // Loại nguồn đích hợp lệ cho từng loại chuyển — phải khớp TRANSFER_FORM_TARGETS bên server.
  const TARGETS = { DEBT: ['CARD', 'LOAN'], INVEST: ['INVEST'], LEND: ['LENT'] };

  const sync = (form) => {
    const kind = form.querySelector('[data-tx-kind]');
    if (!kind) return;
    const allowed = TARGETS[kind.value] || null;
    // 'TRANSFER' là khoản cũ do bot tạo (sang tài khoản): vẫn cho sửa, nguồn đích để nguyên không lọc.
    const transfer = !!allowed || kind.value === 'TRANSFER';
    const debt = kind.value === 'DEBT';
    form.querySelectorAll('[data-tx-target]').forEach((box) => {
      box.hidden = !transfer;
    });
    form.querySelectorAll('[data-tx-debt]').forEach((box) => {
      box.hidden = !debt;
    });
    form.querySelectorAll('[data-tx-amount]').forEach((box) => {
      box.hidden = debt;
    });
    form.querySelectorAll('[data-tx-purpose]').forEach((box) => {
      box.hidden = transfer;
    });
    // Ô lãi của khoản định kỳ (chọn "tự tính theo lãi suất") chỉ có nghĩa với Trả nợ.
    form.querySelectorAll('[data-tx-interest]').forEach((box) => {
      box.hidden = !debt;
    });
    syncTarget(form, allowed);
  };

  // Ô "Sang nguồn" chỉ để lại nguồn đúng loại của lựa chọn đang chọn (kèm `disabled` vì Safari cũ
  // không nghe `hidden` trên <option>); đang trỏ nguồn không hợp lệ thì nhảy về nguồn hợp lệ đầu tiên.
  const syncTarget = (form, allowed) => {
    const target = form.querySelector('select[name="targetSourceId"]');
    if (!target) return;
    let firstOk = '';
    Array.prototype.forEach.call(target.options, (option) => {
      const fits = !allowed || allowed.indexOf(option.dataset.sourceKind) >= 0;
      const off = !!allowed && !!option.value && !fits;
      option.hidden = off;
      option.disabled = off;
      if (allowed && fits && option.value && !firstOk) firstOk = option.value;
    });
    // Chọn sẵn nguồn hợp lệ đầu tiên: đang trỏ nguồn khác (vừa đổi loại) hay chưa chọn gì đều nhảy về
    // đó, khỏi lỡ ghi một khoản chuyển không có nguồn đích.
    if (allowed && (!target.value || target.selectedOptions[0].disabled)) target.value = firstOk;
  };
  document.querySelectorAll('[data-tx-form]').forEach(sync);

  // Form nguồn tiền: ô nào mang data-for="BANK CARD" chỉ hiện khi loại nằm trong danh sách. Hai cặp ô
  // cùng ý nghĩa (Số dư / Nợ hiện tại → currentBalance; Số tài khoản / 4 số cuối thẻ → matchKey) chỉ
  // ô đang hiện mới mang name, để form không gửi hai giá trị cùng tên.
  const syncSource = (form) => {
    const kind = form.querySelector('[data-source-kind]');
    if (!kind) return;
    // Timo báo số dư trong từng mail nên tài khoản Timo không khai số dư: ô Số dư nhường chỗ cho dòng ghi chú.
    const bank = form.querySelector('select[name="bank"]');
    const timoBank = kind.value === 'BANK' && bank && bank.value === 'TIMO';
    form.querySelectorAll('[data-for]').forEach((box) => {
      let shown = box.dataset.for.split(' ').includes(kind.value);
      if (box.hasAttribute('data-balance-box') && timoBank) shown = false;
      if (box.hasAttribute('data-timo-note')) shown = timoBank;
      box.hidden = !shown;
      const opening = box.querySelector('[data-opening]');
      if (opening) opening.name = shown ? 'currentBalance' : '';
      const key = box.querySelector('[data-match-key]');
      if (key) key.name = shown ? 'matchKey' : '';
    });
  };
  document.querySelectorAll('[data-source-form]').forEach(syncSource);
  document.addEventListener('change', (event) => {
    const control = event.target instanceof Element ? event.target.closest('[data-source-kind], select[name="bank"]') : null;
    if (control && control.form && control.form.hasAttribute('data-source-form')) syncSource(control.form);
  });
  document.addEventListener('change', (event) => {
    const kind = event.target instanceof Element ? event.target.closest('[data-tx-kind]') : null;
    if (kind && kind.form) sync(kind.form);
  });
})();
