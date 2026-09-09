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
  };
  document.querySelectorAll('[data-tx-form]').forEach(sync);
  document.addEventListener('change', (event) => {
    const kind = event.target instanceof Element ? event.target.closest('[data-tx-kind]') : null;
    if (kind && kind.form) sync(kind.form);
  });
})();
