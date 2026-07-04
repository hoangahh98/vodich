(() => {
  document.querySelectorAll('[data-menu-toggle]').forEach((button) => {
    const menu = button.closest('.bottom-menu');
    let closeTimer = null;
    const closeMenu = () => menu?.classList.remove('open');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
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
