(() => {
  document.querySelectorAll('[data-menu-toggle]').forEach((button) => {
    const menu = button.closest('.bottom-menu');
    let closeTimer = null;
    let dragState = null;
    let keepTimer = null;
    let suppressClick = false;
    const closeMenu = () => menu?.classList.remove('open');
    const storageKey = 'vodichBottomMenuPosition';
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const applyPosition = (left, top) => {
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      const nextLeft = clamp(left, 8, window.innerWidth - rect.width - 8);
      const nextTop = clamp(top, 8, window.innerHeight - rect.height - 8);
      menu.style.left = `${nextLeft}px`;
      menu.style.top = `${nextTop}px`;
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
    };
    const keepInViewport = () => {
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
      const nextRect = menu.getBoundingClientRect();
      window.localStorage.setItem(storageKey, JSON.stringify({ left: nextRect.left, top: nextRect.top }));
    };
    const resetInteraction = () => {
      dragState = null;
      suppressClick = false;
      delete button.dataset.justDragged;
      menu?.classList.remove('is-dragging');
      closeMenu();
    };
    const scheduleKeepInViewport = () => {
      window.clearTimeout(keepTimer);
      keepTimer = window.setTimeout(() => {
        resetInteraction();
        keepInViewport();
      }, 120);
    };
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) applyPosition(saved.left, saved.top);
    } catch (_) {}
    window.addEventListener('resize', scheduleKeepInViewport);
    window.addEventListener('orientationchange', scheduleKeepInViewport);
    button.addEventListener('pointerdown', (event) => {
      if (!menu || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.stopPropagation();
      window.clearTimeout(closeTimer);
      window.clearTimeout(keepTimer);
      const rect = menu.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
        wasOpen: menu.classList.contains('open'),
      };
      closeMenu();
      button.setPointerCapture?.(event.pointerId);
    });
    button.addEventListener('pointermove', (event) => {
      if (!menu || !dragState || dragState.pointerId !== event.pointerId) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (Math.abs(dx) + Math.abs(dy) < 8) return;
      event.preventDefault();
      dragState.moved = true;
      menu.classList.add('is-dragging');
      closeMenu();
      applyPosition(dragState.left + dx, dragState.top + dy);
    });
    button.addEventListener('pointerup', (event) => {
      if (!menu || !dragState || dragState.pointerId !== event.pointerId) return;
      const moved = dragState.moved;
      const wasOpen = dragState.wasOpen;
      dragState = null;
      menu.classList.remove('is-dragging');
      button.releasePointerCapture?.(event.pointerId);
      const rect = menu.getBoundingClientRect();
      window.localStorage.setItem(storageKey, JSON.stringify({ left: rect.left, top: rect.top }));
      event.preventDefault();
      event.stopPropagation();
      suppressClick = true;
      button.dataset.justDragged = 'true';
      if (moved) {
        closeMenu();
      } else if (!wasOpen) {
        menu.classList.add('open');
      }
      window.setTimeout(() => {
        suppressClick = false;
        delete button.dataset.justDragged;
      }, 180);
    });
    button.addEventListener('pointercancel', () => {
      resetInteraction();
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (suppressClick || button.dataset.justDragged === 'true') return;
      const menu = button.closest('.bottom-menu');
      menu?.classList.toggle('open');
    });
    menu?.addEventListener('mouseenter', () => window.clearTimeout(closeTimer));
    menu?.addEventListener('mouseleave', () => {
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(closeMenu, 250);
    });
    document.addEventListener('click', (event) => {
      if (!menu?.contains(event.target)) closeMenu();
    });
  });
})();
