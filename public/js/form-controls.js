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
    }
    // Thủ công vượt quỹ hiện có thì KHÔNG chặn: lúc tạo giải quỹ luôn là 0đ vì chưa ai đóng phí.
    // Ô "còn lại" đã đỏ lên để ban tổ chức tự cân đối khi tiền về.
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
    const pairingRuleField = document.getElementById('pairingRuleField');
    const americanoNote = document.getElementById('americanoNote');
    if ((!formatSelect && !formatRadios.length) || !qualifierField) return;

    const currentFormat = () => formatSelect?.value || formatRadios.find((radio) => radio.checked)?.value;
    const estimatedTeamCount = () => {
      // Ở trang Cài đặt, số người không nằm trong form này mà đọc từ giải đã lưu (data-expected-players).
      const players = Number.parseInt(expectedPlayersInput?.value || qualifierField.dataset.expectedPlayers || '0', 10) || 0;
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
      const format = currentFormat();
      const americano = format === 'AMERICANO';
      qualifierField.classList.toggle('hidden', format !== 'GROUP_KNOCKOUT');
      americanoNote?.classList.toggle('hidden', !americano);
      // Đôi xoay vòng luôn là đánh đôi: khoá ô "Loại đấu" lại thay vì để người dùng chọn ra
      // một cấu hình mà server sẽ âm thầm sửa lại. Server vẫn ép, đây chỉ là nói trước.
      if (playTypeSelect) {
        if (americano) playTypeSelect.value = 'DOUBLES';
        playTypeSelect.disabled = americano;
        playTypeSelect.title = americano ? 'Đôi xoay vòng luôn là đánh đôi' : '';
      }
      // Ghép cặp chỉ có nghĩa khi đánh đôi.
      pairingRuleField?.classList.toggle('hidden', !americano && playTypeSelect?.value !== 'DOUBLES');
      syncKnockout();
    };
    formatSelect?.addEventListener('change', sync);
    formatRadios.forEach((radio) => radio.addEventListener('change', sync));
    [finalBox, semiBox, quarterBox].forEach((box) => box?.addEventListener('change', syncKnockout));
    [expectedPlayersInput, playTypeSelect].forEach((item) => item?.addEventListener('input', sync));
    [expectedPlayersInput, playTypeSelect].forEach((item) => item?.addEventListener('change', sync));
    sync();
  };

  // Lệ phí nhập trước rồi mới nhập được chi phí; nhập đủ Sân bãi + Ăn uống + Giải thưởng
  // (Khác không bắt buộc) thì mới mở Cài đặt giải thưởng. Chỉ khoá ở giao diện (readonly +
  // is-locked), KHÔNG disable — input disabled không gửi lên, lưu là mất số cũ.
  const initFeeGate = () => {
    const feeInput = document.querySelector('[data-fee-input]');
    if (!feeInput) return;
    const form = feeInput.closest('form');
    const costFields = form?.querySelector('[data-cost-fields]');
    const prizeSection = form?.querySelector('[data-prize-section]');
    const lockNote = form?.querySelector('[data-prize-lock-note]');
    const requiredInputs = [...(costFields?.querySelectorAll('[data-money-required]') || [])];
    const lock = (root, locked) => {
      if (!root) return;
      root.classList.toggle('is-locked', locked);
      root.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]), button').forEach((el) => {
        if (el.tagName === 'BUTTON') el.disabled = locked;
        else el.readOnly = locked;
      });
    };
    // Gợi ý ngân sách giải thưởng = lệ phí × số người dự kiến − sân bãi − ăn uống − khác.
    const suggestEl = form?.querySelector('[data-prize-cost-suggest]');
    const fillButton = form?.querySelector('[data-fill-prize-cost]');
    const prizeCostInput = form?.querySelector('[name="prizeCost"]');
    const suggestedPrizeCost = () => {
      const players = Number.parseInt(costFields?.dataset.expectedPlayers || '0', 10) || 0;
      const spent = ['courtCost', 'foodCost', 'otherCost'].reduce((sum, name) => sum + parseMoneyValue(form?.querySelector(`[name="${name}"]`)?.value), 0);
      return Math.max(0, parseMoneyValue(feeInput.value) * players - spent);
    };
    const sync = () => {
      const feeOk = parseMoneyValue(feeInput.value) > 0;
      lock(costFields, !feeOk);
      if (suggestEl) suggestEl.textContent = `${formatMoneyValue(suggestedPrizeCost())}đ`;
      const complete = feeOk && requiredInputs.every((input) => input.value.trim() !== '');
      lock(prizeSection, !complete);
      if (lockNote) lockNote.hidden = complete;
    };
    [feeInput, ...requiredInputs, form?.querySelector('[name="otherCost"]')].forEach((input) => input?.addEventListener('input', sync));
    fillButton?.addEventListener('click', () => {
      if (!prizeCostInput) return;
      prizeCostInput.value = formatMoneyValue(suggestedPrizeCost());
      prizeCostInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
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
    const modeRadios = [...box.querySelectorAll('input[name="feeMode"]')];
    const fillButton = box.querySelector('[data-fill-fee-suggestion]');
    const isAuto = () => (modeRadios.length ? modeRadios.find((radio) => radio.checked)?.value !== 'MANUAL' : false);
    const sync = () => {
      if (label) label.textContent = `${formatMoneyValue(suggestion())}đ`;
      // Tự chia đều: ô phí chỉ hiện, không sửa được — server tính lại từ chi phí và số cố định.
      if (feeInput && isAuto()) {
        feeInput.value = formatMoneyValue(suggestion());
        feeInput.readOnly = true;
      } else if (feeInput) {
        feeInput.readOnly = false;
      }
      fillButton?.classList.toggle('hidden', isAuto());
    };
    ['courtCost', 'otherCost', 'previousBalance'].forEach((name) => box.querySelector(`[name="${name}"]`)?.addEventListener('input', sync));
    modeRadios.forEach((radio) => radio.addEventListener('change', sync));
    fillButton?.addEventListener('click', () => {
      if (feeInput) feeInput.value = formatMoneyValue(suggestion());
    });
    sync();
  };

  window.Vodich = { ...(window.Vodich || {}), validateTournamentPrizeForm };
  initKnockoutOptions();
  initPrizeOptions();
  initFeeGate();
  initTeamFeeSuggestion();
})();
