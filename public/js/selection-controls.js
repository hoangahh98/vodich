(() => {
  const initManualPairs = () => {
    const selects = [...document.querySelectorAll('[data-manual-pair-select]')];
    if (!selects.length) return;
    selects.forEach((select) => {
      select.dataset.options = JSON.stringify([...select.options].map((option) => ({ value: option.value, text: option.textContent || '' })));
    });
    const sync = () => {
      const selected = new Set(selects.map((select) => select.value).filter(Boolean));
      selects.forEach((select) => {
        const currentValue = select.value;
        const options = JSON.parse(select.dataset.options || '[]');
        select.replaceChildren();
        options.forEach((option) => {
          if (option.value && option.value !== currentValue && selected.has(option.value)) return;
          select.add(new Option(option.text, option.value, false, option.value === currentValue));
        });
      });
    };
    selects.forEach((select) => select.addEventListener('change', sync));
    sync();
  };

  const initTeamMemberPicker = () => {
    const picker = document.querySelector('[data-team-member-picker]');
    if (!picker) return;
    const checkboxes = [...picker.querySelectorAll('input[type="checkbox"][name="playerIds"]')];
    const counter = document.querySelector('[data-team-member-count]');
    const sync = () => {
      const count = checkboxes.filter((checkbox) => checkbox.checked).length;
      if (!counter) return;
      counter.textContent = `Đã chọn ${count} thành viên`;
      counter.classList.toggle('text-danger', count === 0);
      counter.classList.toggle('text-primary', count > 0);
    };
    checkboxes.forEach((checkbox) => checkbox.addEventListener('change', sync));
    sync();
  };

  const initCheckAll = () => {
    document.querySelectorAll('[data-check-all]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        document.querySelectorAll(checkbox.dataset.checkAll).forEach((item) => {
          if (item instanceof HTMLInputElement) item.checked = checkbox.checked;
        });
      });
    });
  };

  const initPlayerSlotHint = () => {
    const hint = document.getElementById('playerSlotHint');
    const picker = document.querySelector('[data-player-picker]');
    if (!hint || !picker) return;
    const totalSlots = Number.parseInt(hint.dataset.slotsLeft || '0', 10) || 0;
    const slotCount = hint.querySelector('[data-slot-count]');
    const selectedCount = hint.querySelector('[data-selected-count]');
    const sync = () => {
      const selected = picker.querySelectorAll('input[type="checkbox"]:checked').length;
      const officialLeft = Math.max(0, totalSlots - selected);
      if (slotCount) slotCount.textContent = String(officialLeft);
      if (selectedCount) selectedCount.textContent = String(selected);
      hint.classList.toggle('warn', officialLeft === 0);
      hint.classList.toggle('info', officialLeft > 0);
    };
    picker.addEventListener('change', sync);
    sync();
  };

  // Ô tìm nhanh cho danh sách tích chọn dài: gõ tên/email, so không dấu; người đã tích luôn hiện
  // để không "mất" lựa chọn khi lọc. Đếm số hiện/tổng để biết còn bao nhiêu người khớp.
  const initCheckFilter = () => {
    const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
    document.querySelectorAll('[data-check-filter]').forEach((input) => {
      const list = document.getElementById(input.dataset.checkFilter);
      if (!list) return;
      const rows = [...list.querySelectorAll('label')];
      const counter = input.parentElement ? input.parentElement.querySelector('[data-check-filter-count]') : null;
      const empty = list.querySelector('[data-check-filter-empty]');
      rows.forEach((row) => { row.dataset.fold = fold(row.textContent); });
      const apply = () => {
        const needle = fold(input.value.trim());
        let shown = 0;
        rows.forEach((row) => {
          const checkbox = row.querySelector('input[type="checkbox"]');
          const hit = !needle || row.dataset.fold.includes(needle) || (checkbox && checkbox.checked);
          row.hidden = !hit;
          if (hit) shown += 1;
        });
        if (counter) counter.textContent = needle ? `${shown}/${rows.length}` : `${rows.length}`;
        if (empty) empty.hidden = shown > 0 || !rows.length;
      };
      input.addEventListener('input', apply);
      list.addEventListener('change', apply);
      apply();
    });
  };

  initManualPairs();
  initTeamMemberPicker();
  initCheckFilter();
  initCheckAll();
  initPlayerSlotHint();
})();
