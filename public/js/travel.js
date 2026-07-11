(() => {
  // Toggle lưới "chi riêng" khi thêm khoản chi.
  const splitMode = document.querySelector('[data-travel-split-mode]');
  const privateGrid = document.querySelector('[data-travel-private-grid]');
  if (splitMode && privateGrid) {
    const sync = () => privateGrid.classList.toggle('hidden', splitMode.value !== 'PRIVATE');
    splitMode.addEventListener('change', sync);
    sync();
  }

  // Danh sách thành viên: chỉ bật nút "Lưu" khi có chỉnh sửa.
  const memberList = document.querySelector('[data-member-list]');
  const saveBtn = document.querySelector('[data-dirty-save]');
  if (memberList && saveBtn) {
    memberList.addEventListener('input', () => {
      saveBtn.disabled = false;
    });
  }
})();
