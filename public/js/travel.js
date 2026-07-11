(() => {
  // --- Tab switching (client-side, giữ nguyên route/redirect) ---
  const tabBar = document.querySelector('[data-travel-tabs]');
  const panels = Array.from(document.querySelectorAll('[data-travel-panel]'));
  const shell = document.querySelector('[data-travel-trip-id]');
  if (tabBar && panels.length) {
    const tripId = shell ? shell.getAttribute('data-travel-trip-id') : 'x';
    const storageKey = `travel-tab-${tripId}`;
    const buttons = Array.from(tabBar.querySelectorAll('[data-travel-tab]'));
    const validKeys = new Set(panels.map((panel) => panel.getAttribute('data-travel-panel')));

    const activate = (key) => {
      if (!validKeys.has(key)) key = panels[0].getAttribute('data-travel-panel');
      panels.forEach((panel) => panel.classList.toggle('active', panel.getAttribute('data-travel-panel') === key));
      buttons.forEach((button) => button.classList.toggle('active', button.getAttribute('data-travel-tab') === key));
      try {
        sessionStorage.setItem(storageKey, key);
      } catch (_) {}
    };

    buttons.forEach((button) => button.addEventListener('click', () => activate(button.getAttribute('data-travel-tab'))));

    let initial = panels[0].getAttribute('data-travel-panel');
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && validKeys.has(saved)) initial = saved;
    } catch (_) {}
    activate(initial);
  }

  // --- Toggle lưới "chi riêng" khi thêm khoản chi ---
  const splitMode = document.querySelector('[data-travel-split-mode]');
  const privateGrid = document.querySelector('[data-travel-private-grid]');
  if (splitMode && privateGrid) {
    const sync = () => privateGrid.classList.toggle('hidden', splitMode.value !== 'PRIVATE');
    splitMode.addEventListener('change', sync);
    sync();
  }
})();
