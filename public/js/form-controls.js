(() => {
  const { formatMoneyValue, parseMoneyValue } = window.Vodich || {};
  if (typeof parseMoneyValue !== 'function' || typeof formatMoneyValue !== 'function') return;

  const currentPrizeFund = (form) => {
    const totalPaid = parseMoneyValue(form?.dataset.prizeTotalPaid || '0');
    if (!form) return 0;
    const operatingCost = ['courtCost', 'foodCost', 'otherCost'].reduce((sum, name) => sum + parseMoneyValue(form.querySelector(`[name="${name}"]`)?.value), 0);
    return Math.max(0, totalPaid - operatingCost);
  };

  const manualPrizeTotal = (form) => ['prizeRate1', 'prizeRate2', 'prizeRate3'].reduce((sum, name) => sum + parseMoneyValue(form?.querySelector(`[name="${name}"]`)?.value), 0);

  const prizeSuggestion = (prizeFund) => {
    const first = Math.floor(prizeFund * 0.5);
    const second = Math.floor(prizeFund * 0.3);
    return [first, second, Math.max(0, prizeFund - first - second)];
  };

  const validateTournamentPrizeForm = (form) => {
    const prizeMode = form.querySelector('input[name="prizeMode"]:checked');
    if (prizeMode?.value === 'percent') {
      const total = ['prizeRate1', 'prizeRate2', 'prizeRate3'].reduce((sum, name) => sum + parseMoneyValue(form.querySelector(`[name="${name}"]`)?.value), 0);
      if (total > 100) {
        alert('Tổng tỷ lệ giải thưởng không được vượt quá 100%.');
        return false;
      }
    } else if (prizeMode?.value === 'manual') {
      const prizeFund = currentPrizeFund(form);
      const total = manualPrizeTotal(form);
      if (total > prizeFund) {
        alert(`Tổng tiền thưởng thủ công không được vượt quá quỹ thưởng hiện có (${formatMoneyValue(prizeFund)}đ).`);
        return false;
      }
    }
    return true;
  };

  const initKnockoutOptions = () => {
    const formatSelect = document.querySelector('select[name="format"]');
    const formatRadios = [...document.querySelectorAll('input[name="format"]')];
    const qualifierField = document.getElementById('knockoutQualifierField');
    const qualifierInput = document.getElementById('knockoutQualifierCount');
    const finalBox = document.getElementById('knockoutFinal');
    const semiBox = document.getElementById('knockoutSemi');
    const quarterBox = document.getElementById('knockoutQuarter');
    const expectedPlayersInput = document.querySelector('input[name="expectedPlayers"]');
    const playTypeSelect = document.querySelector('select[name="playType"]');
    if ((!formatSelect && !formatRadios.length) || !qualifierField) return;

    const currentFormat = () => formatSelect?.value || formatRadios.find((radio) => radio.checked)?.value;
    const estimatedTeamCount = () => {
      const players = Number.parseInt(expectedPlayersInput?.value || '0', 10) || 0;
      return playTypeSelect?.value === 'DOUBLES' ? Math.floor(players / 2) : players;
    };
    const syncKnockout = () => {
      if (!qualifierInput || !finalBox || !semiBox || !quarterBox) return;
      const teamCount = estimatedTeamCount();
      [finalBox, semiBox, quarterBox].forEach((box) => {
        const enoughTeams = teamCount >= (Number.parseInt(box.dataset.minTeams || '0', 10) || 0);
        box.disabled = !enoughTeams;
        if (!enoughTeams) box.checked = false;
      });
      if (finalBox.disabled) {
        qualifierInput.value = '2';
        return;
      }
      if (semiBox.disabled || !finalBox.checked) semiBox.checked = false;
      if (quarterBox.disabled || !semiBox.checked) quarterBox.checked = false;
      if (quarterBox.checked) {
        semiBox.checked = true;
        finalBox.checked = true;
        qualifierInput.value = '8';
        return;
      }
      if (semiBox.checked) {
        finalBox.checked = true;
        qualifierInput.value = '4';
        return;
      }
      finalBox.checked = true;
      qualifierInput.value = '2';
    };
    const sync = () => {
      qualifierField.classList.toggle('hidden', currentFormat() !== 'GROUP_KNOCKOUT');
      syncKnockout();
    };
    formatSelect?.addEventListener('change', sync);
    formatRadios.forEach((radio) => radio.addEventListener('change', sync));
    [finalBox, semiBox, quarterBox].forEach((box) => box?.addEventListener('change', syncKnockout));
    [expectedPlayersInput, playTypeSelect].forEach((item) => item?.addEventListener('input', sync));
    [expectedPlayersInput, playTypeSelect].forEach((item) => item?.addEventListener('change', sync));
    sync();
  };

  const initPrizeOptions = () => {
    const prizeRadios = [...document.querySelectorAll('input[name="prizeMode"]')];
    if (!prizeRadios.length) return;
    const form = prizeRadios[0].closest('form');
    const sync = () => {
      const manual = prizeRadios.find((radio) => radio.checked)?.value === 'manual';
      const prizeFund = currentPrizeFund(form);
      const total = manualPrizeTotal(form);
      const left = prizeFund - total;
      document.querySelectorAll('[data-prize-label]').forEach((label) => {
        label.textContent = `Giải ${label.dataset.prizeLabel} ${manual ? '(đ)' : '(%)'}`;
      });
      document.querySelector('[data-manual-prize-summary]')?.classList.toggle('hidden', !manual);
      const fundEl = document.querySelector('[data-prize-fund]');
      const totalEl = document.querySelector('[data-manual-prize-total]');
      const leftEl = document.querySelector('[data-manual-prize-left]');
      if (fundEl) fundEl.textContent = `${formatMoneyValue(prizeFund)}đ`;
      if (totalEl) totalEl.textContent = `${formatMoneyValue(total)}đ`;
      if (leftEl) {
        leftEl.textContent = `${formatMoneyValue(left)}đ`;
        leftEl.classList.toggle('text-danger', manual && left < 0);
      }
      prizeSuggestion(prizeFund).forEach((value, index) => {
        const el = document.querySelector(`[data-prize-suggest="${index + 1}"]`);
        if (el) el.textContent = `${formatMoneyValue(value)}đ`;
      });
      document.querySelector('[data-prize-fund-box]')?.classList.toggle('warn', manual && left < 0);
    };
    prizeRadios.forEach((radio) => radio.addEventListener('change', sync));
    ['courtCost', 'foodCost', 'otherCost', 'prizeRate1', 'prizeRate2', 'prizeRate3'].forEach((name) => {
      form?.querySelector(`[name="${name}"]`)?.addEventListener('input', sync);
    });
    document.querySelector('[data-fill-prize-suggestion]')?.addEventListener('click', () => {
      prizeSuggestion(currentPrizeFund(form)).forEach((value, index) => {
        const input = form?.querySelector(`[name="prizeRate${index + 1}"]`);
        if (input) input.value = formatMoneyValue(value);
      });
      const manualRadio = form?.querySelector('input[name="prizeMode"][value="manual"]');
      if (manualRadio) manualRadio.checked = true;
      sync();
    });
    sync();
  };

  // Quỹ tháng đội bóng: gợi ý mức phí / người = (sân + khác - dư tháng trước) / số cố định,
  // làm tròn LÊN bội số 1.000đ. Giữ đúng công thức suggestMonthlyFee bên team-month-report.ts.
  const initTeamFeeSuggestion = () => {
    const box = document.querySelector('[data-team-fund]');
    if (!box) return;
    const label = box.querySelector('[data-fee-suggest]');
    const feeInput = box.querySelector('[name="monthlyFee"]');
    const fixedCount = Number.parseInt(box.dataset.fixedCount || '0', 10) || 0;
    const suggestion = () => {
      if (fixedCount <= 0) return 0;
      const need = ['courtCost', 'otherCost'].reduce((sum, name) => sum + parseMoneyValue(box.querySelector(`[name="${name}"]`)?.value), 0) - parseMoneyValue(box.querySelector('[name="previousBalance"]')?.value);
      return need <= 0 ? 0 : Math.ceil(need / fixedCount / 1000) * 1000;
    };
    const sync = () => {
      if (label) label.textContent = `${formatMoneyValue(suggestion())}đ`;
    };
    ['courtCost', 'otherCost', 'previousBalance'].forEach((name) => box.querySelector(`[name="${name}"]`)?.addEventListener('input', sync));
    box.querySelector('[data-fill-fee-suggestion]')?.addEventListener('click', () => {
      if (feeInput) feeInput.value = formatMoneyValue(suggestion());
    });
    sync();
  };

  // Sổ chi tiêu: ô nhập đổi theo KIỂU của loại đang chọn.
  //   debt  -> Gốc / Lãi / chọn khoản nợ   (ẩn ô Số tiền, vì tiền = gốc + lãi)
  //   fixed -> Số tiền DỰ KIẾN + Đã chi thực tế
  //   khác  -> chỉ một ô Số tiền
  // Đây CHỈ là tiện nghi — không có JS thì mọi ô đều hiện và service vẫn đọc đúng ô theo
  // kiểu của loại, nên không bao giờ ghi sai.
  const initHouseholdEntryForm = () => {
    document.querySelectorAll('form[data-entry-form]').forEach((form) => {
      const select = form.querySelector('[data-entry-kind]');
      if (!select) return;
      const debtFields = [...form.querySelectorAll('[data-entry-debt]')];
      const plainFields = [...form.querySelectorAll('[data-entry-plain]')];
      const actualFields = [...form.querySelectorAll('[data-entry-actual]')];
      const savingFields = [...form.querySelectorAll('[data-entry-saving]')];
      const amountLabel = form.querySelector('[data-amount-label]');
      const sync = () => {
        const kind = select.selectedOptions[0]?.dataset.kind;
        const isDebt = kind === 'debt';
        const isFixed = kind === 'fixed';
        debtFields.forEach((field) => field.classList.toggle('hidden', !isDebt));
        plainFields.forEach((field) => field.classList.toggle('hidden', isDebt));
        actualFields.forEach((field) => field.classList.toggle('hidden', !isFixed));
        savingFields.forEach((field) => field.classList.toggle('hidden', kind !== 'saving'));
        if (amountLabel) amountLabel.textContent = isFixed ? 'Số tiền dự kiến' : 'Số tiền';
      };
      select.addEventListener('change', sync);
      sync();
    });
  };

  window.Vodich = { ...(window.Vodich || {}), validateTournamentPrizeForm };
  initKnockoutOptions();
  initPrizeOptions();
  initTeamFeeSuggestion();
  initHouseholdEntryForm();
})();
