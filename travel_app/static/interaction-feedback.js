(function() {
    function markBusy(button, text) {
        if (!button || button.dataset.busy === '1') {
            return;
        }
        button.dataset.busy = '1';
        button.dataset.originalHtml = button.innerHTML;
        button.classList.add('disabled');
        button.setAttribute('aria-disabled', 'true');
        if ('disabled' in button) {
            button.disabled = true;
        }
        button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>' + text;
    }

    document.addEventListener('submit', function(event) {
        const form = event.target;
        if (!form || form.dataset.feedback === 'off') {
            return;
        }

        window.setTimeout(function() {
            if (event.defaultPrevented) {
                return;
            }
            const submitter = event.submitter || form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
            markBusy(submitter, submitter && submitter.dataset.loadingText ? submitter.dataset.loadingText : 'Đang xử lý...');
        }, 0);
    });

    document.addEventListener('click', function(event) {
        const link = event.target.closest('a.btn');
        if (!link || link.dataset.feedback === 'off') {
            return;
        }

        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        const href = link.getAttribute('href') || '';
        const target = link.getAttribute('target') || '';
        const isLocalUiControl = href === '' ||
            href === '#' ||
            href.startsWith('#') ||
            link.hasAttribute('download') ||
            target === '_blank' ||
            link.hasAttribute('data-bs-toggle') ||
            link.hasAttribute('data-bs-target') ||
            link.getAttribute('role') === 'tab';

        if (isLocalUiControl) {
            return;
        }

        event.preventDefault();
        markBusy(link, link.dataset.loadingText || 'Đang xử lý...');
        window.setTimeout(function() {
            window.location.href = link.href;
        }, 120);
    });

    window.addEventListener('pageshow', function() {
        document.querySelectorAll('[data-busy="1"]').forEach(function(item) {
            item.dataset.busy = '0';
            item.classList.remove('disabled');
            item.removeAttribute('aria-disabled');
            if ('disabled' in item) {
                item.disabled = false;
            }
            if (item.dataset.originalHtml) {
                item.innerHTML = item.dataset.originalHtml;
            }
        });
    });
})();
