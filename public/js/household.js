/**
 * Form giao dịch / khoản định kỳ của module Chi tiêu: chọn loại "Chuyển nguồn" thì mới hiện ô
 * "Sang nguồn" và ô lãi. Không có inline script vì CSP script-src 'self'.
 */
(() => {
  const sync = (form) => {
    const kind = form.querySelector('[data-tx-kind]');
    if (!kind) return;
    const transfer = kind.value === 'TRANSFER';
    form.querySelectorAll('[data-tx-target], [data-tx-interest]').forEach((box) => {
      box.hidden = !transfer;
    });
    // Ô "Trong đó lãi" chỉ khi chọn Gốc + lãi.
    const part = form.querySelector('[data-debt-part]');
    form.querySelectorAll('[data-tx-mixed]').forEach((box) => {
      box.hidden = !transfer || !part || part.value !== 'MIXED';
    });
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
    form.querySelectorAll('[data-for]').forEach((box) => {
      const shown = box.dataset.for.split(' ').includes(kind.value);
      box.hidden = !shown;
      const opening = box.querySelector('[data-opening]');
      if (opening) opening.name = shown ? 'currentBalance' : '';
      const key = box.querySelector('[data-match-key]');
      if (key) key.name = shown ? 'matchKey' : '';
    });
  };
  document.querySelectorAll('[data-source-form]').forEach(syncSource);
  document.addEventListener('change', (event) => {
    const kind = event.target instanceof Element ? event.target.closest('[data-source-kind]') : null;
    if (kind && kind.form) syncSource(kind.form);
  });
  document.addEventListener('change', (event) => {
    const kind = event.target instanceof Element ? event.target.closest('[data-tx-kind]') : null;
    if (kind && kind.form) sync(kind.form);
  });
})();
