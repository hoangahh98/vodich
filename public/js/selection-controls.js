(() => {
  const initManualPairs = () => {
    const selects = [...document.querySelectorAll('[data-manual-pair-select]')];
    if (!selects.length) return;
    const form = document.querySelector('[data-manual-pairs-form]');
    const tournamentId = form?.dataset.tournamentId || document.querySelector('[data-tournament-id]')?.dataset.tournamentId || '0';
    const PRESET_KEY = `vodich.manual_preset.${tournamentId}`;
    const SPIN_KEY = `vodich.spin.${tournamentId}`;

    const saveBtn = document.querySelector('[data-manual-save-preset]');
    const clearBtn = document.querySelector('[data-manual-clear-preset]');
    const openSpinBtn = document.querySelector('[data-manual-open-spin]');
    const statusBox = document.querySelector('[data-manual-preset-status]');
    const detailsBox = document.querySelector('.manual-pair-box');

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

    const renderPresetStatus = (preset) => {
      if (!statusBox) return;
      if (Array.isArray(preset) && preset.length > 0) {
        statusBox.textContent = `✓ Đang lưu ${preset.length} đội thủ công cho vòng quay (kết quả quay sẽ trúng các đội này).`;
        statusBox.classList.remove('hidden');
        if (clearBtn) clearBtn.classList.remove('hidden');
        if (openSpinBtn) openSpinBtn.classList.remove('hidden');
      } else {
        statusBox.textContent = '';
        statusBox.classList.add('hidden');
        if (clearBtn) clearBtn.classList.add('hidden');
        if (openSpinBtn) openSpinBtn.classList.add('hidden');
      }
    };

    const loadSavedPreset = () => {
      try {
        const raw = window.localStorage.getItem(PRESET_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
      } catch (_) {
        return null;
      }
    };

    // Nạp lại cấu hình đã lưu vào form nếu có
    const initialPreset = loadSavedPreset();
    if (initialPreset && initialPreset.length > 0) {
      initialPreset.forEach((item, index) => {
        const slotIdx = index + 1;
        const selectA = document.querySelector(`select[name="teamA_${slotIdx}"]`);
        const selectB = document.querySelector(`select[name="teamB_${slotIdx}"]`);
        const groupSel = document.querySelector(`select[name="group_${slotIdx}"]`);
        if (selectA && item.team && item.team[0]) selectA.value = item.team[0];
        if (selectB && item.team && item.team[1]) selectB.value = item.team[1];
        if (groupSel && item.group) groupSel.value = item.group;
      });
      sync();
      renderPresetStatus(initialPreset);
      if (detailsBox) detailsBox.open = true;
    } else {
      sync();
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const cards = [...document.querySelectorAll('.manual-pair-card')];
        const teams = [];
        cards.forEach((card, idx) => {
          const slot = idx + 1;
          const selectA = card.querySelector(`select[name="teamA_${slot}"]`);
          const selectB = card.querySelector(`select[name="teamB_${slot}"]`);
          const groupSel = card.querySelector(`select[name="group_${slot}"]`);
          const valA = selectA ? selectA.value.trim() : '';
          const valB = selectB ? selectB.value.trim() : '';
          const group = groupSel ? groupSel.value.trim() : null;

          if (selectB) {
            // Đôi: cần đủ cả 2 người
            if (valA && valB && valA !== valB) {
              teams.push({ team: [valA, valB], group: group || null });
            }
          } else {
            // Đơn: cần 1 người
            if (valA) {
              teams.push({ team: [valA], group: group || null });
            }
          }
        });

        if (!teams.length) {
          alert('Vui lòng chọn ít nhất một đội đủ thành viên trước khi lưu.');
          return;
        }

        try {
          window.localStorage.setItem(PRESET_KEY, JSON.stringify(teams));
          window.localStorage.removeItem(SPIN_KEY); // Xoá nháp vòng quay cũ để vòng quay nhận cấu hình mới
        } catch (_) {}

        renderPresetStatus(teams);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        try {
          window.localStorage.removeItem(PRESET_KEY);
          window.localStorage.removeItem(SPIN_KEY);
        } catch (_) {}
        selects.forEach((select) => { select.value = ''; });
        document.querySelectorAll('[data-manual-group-select]').forEach((sel) => { sel.value = ''; });
        sync();
        renderPresetStatus(null);
      });
    }

    if (form) {
      // Khi bấm "Tạo trận từ đội đã chọn", tạo lịch xong cũng xoá lưu thủ công
      form.addEventListener('submit', () => {
        try {
          window.localStorage.removeItem(PRESET_KEY);
          window.localStorage.removeItem(SPIN_KEY);
        } catch (_) {}
      });
    }
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
  //
  // Mỗi "dòng" mặc định là một <label> (danh sách tích chọn). Bảng sửa được như trang Thành viên thì
  // đánh dấu từng <tr data-filter-row>: tên/email nằm trong VALUE của ô nhập chứ không phải chữ, nên
  // phải đọc cả value — từng chỉ đọc textContent của <label> bọc ô nhập (luôn rỗng) nên gõ gì cũng ra
  // 0 người, lại còn giấu ô tên/email bên trong dòng thay vì giấu cả dòng (chủ app báo 6/10/2026).
  const initCheckFilter = () => {
    const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
    const rowText = (row) => [row.textContent, ...[...row.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"])')].map((field) => field.value)].join(' ');
    document.querySelectorAll('[data-check-filter]').forEach((input) => {
      const list = document.getElementById(input.dataset.checkFilter);
      if (!list) return;
      const tableRows = [...list.querySelectorAll('[data-filter-row]')];
      const rows = tableRows.length ? tableRows : [...list.querySelectorAll('label')];
      const counter = input.parentElement ? input.parentElement.querySelector('[data-check-filter-count]') : null;
      const empty = list.querySelector('[data-check-filter-empty]');
      const apply = () => {
        const needle = fold(input.value.trim());
        let shown = 0;
        rows.forEach((row) => {
          const checkbox = row.querySelector('input[type="checkbox"]');
          // Đọc lại mỗi lần lọc: người dùng có thể vừa sửa tên trong ô nhập.
          const hit = !needle || fold(rowText(row)).includes(needle) || (checkbox && checkbox.checked);
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
