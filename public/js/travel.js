(() => {
  // Toggle lưới "chi riêng" khi thêm khoản chi.
  const splitMode = document.querySelector('[data-travel-split-mode]');
  const privateGrid = document.querySelector('[data-travel-private-grid]');
  if (splitMode && privateGrid) {
    const sync = () => privateGrid.classList.toggle('hidden', splitMode.value !== 'PRIVATE');
    splitMode.addEventListener('change', sync);
    sync();
  }

  // Bật nút "Lưu thay đổi" khi có chỉnh sửa trong vùng theo dõi (thành viên / khoản chi).
  const enableSave = () => document.querySelectorAll('[data-dirty-save]').forEach((btn) => (btn.disabled = false));
  document.querySelectorAll('[data-dirty-watch]').forEach((zone) => zone.addEventListener('input', enableSave));
})();
