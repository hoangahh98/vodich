(() => {
  // Toggle lưới "chi riêng" khi thêm khoản chi.
  const splitMode = document.querySelector('[data-travel-split-mode]');
  const privateGrid = document.querySelector('[data-travel-private-grid]');
  if (!splitMode || !privateGrid) return;
  const sync = () => privateGrid.classList.toggle('hidden', splitMode.value !== 'PRIVATE');
  splitMode.addEventListener('change', sync);
  sync();
})();
