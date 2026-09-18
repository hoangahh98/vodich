/**
 * Form giao dịch / khoản định kỳ của module Chi tiêu: chọn loại "Chuyển nguồn" thì mới hiện ô
 * "Sang nguồn" và ô lãi. Không có inline script vì CSP script-src 'self'.
 *
 * Loại "Đầu tư" cũng là chuyển nguồn (server ghi TRANSFER) nhưng tiền sang nguồn Đầu tư: ô "Sang
 * nguồn" chỉ còn nguồn Đầu tư, và hai ô "Khoản chuyển này là" + "Mục đích" biến mất (chủ app
 * 18/9/2026). Ô giấu bằng `hidden` VẪN gửi giá trị lên, nên server cũng bỏ hai giá trị ấy.
 */
(() => {
  const sync = (form) => {
    const kind = form.querySelector('[data-tx-kind]');
    if (!kind) return;
    const invest = kind.value === 'INVEST';
    const transfer = kind.value === 'TRANSFER' || invest;
    form.querySelectorAll('[data-tx-target]').forEach((box) => {
      box.hidden = !transfer;
    });
    form.querySelectorAll('[data-tx-interest]').forEach((box) => {
      box.hidden = !transfer || invest;
    });
    form.querySelectorAll('[data-tx-purpose]').forEach((box) => {
      box.hidden = invest;
    });
    // Ô "Trong đó lãi" chỉ khi chọn Gốc + lãi.
    const part = form.querySelector('[data-debt-part]');
    form.querySelectorAll('[data-tx-mixed]').forEach((box) => {
      box.hidden = !transfer || invest || !part || part.value !== 'MIXED';
    });
    syncTarget(form, invest);
  };

  // Đầu tư thì ô "Sang nguồn" chỉ để lại nguồn loại Đầu tư (kèm `disabled` vì Safari cũ không nghe
  // `hidden` trên <option>); đang trỏ vào nguồn khác thì nhảy về nguồn Đầu tư đầu tiên.
  const syncTarget = (form, invest) => {
    const target = form.querySelector('select[name="targetSourceId"]');
    if (!target) return;
    let firstInvest = '';
    Array.prototype.forEach.call(target.options, (option) => {
      const investSource = option.dataset.sourceKind === 'INVEST';
      const off = invest && option.value && !investSource;
      option.hidden = off;
      option.disabled = off;
      if (investSource && !firstInvest) firstInvest = option.value;
    });
    // Chỉ còn nguồn Đầu tư chọn được thì chọn sẵn cái đầu tiên: đang trỏ nguồn khác (vừa đổi loại) hay
    // chưa chọn gì đều nhảy về đó, khỏi lỡ ghi một khoản chuyển không có nguồn đích.
    if (invest && (!target.value || target.selectedOptions[0].disabled)) target.value = firstInvest;
  };
  document.addEventListener('change', (event) => {
    const part = event.target instanceof Element ? event.target.closest('[data-debt-part]') : null;
    if (part && part.form) sync(part.form);
  });
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
