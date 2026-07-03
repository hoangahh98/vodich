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

  window.Vodich = { ...(window.Vodich || {}), validateTournamentPrizeForm };
  initKnockoutOptions();
  initPrizeOptions();
})();
