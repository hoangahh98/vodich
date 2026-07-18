// Đăng ký service worker (xem public/sw.js): giữ giao diện khi mở app từ màn hình
// chính iPhone lúc server Render còn đang ngủ dậy.
// Để file riêng vì CSP chặn inline script.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Không đăng ký được (http không phải localhost, chế độ riêng tư...) thì bỏ qua:
      // app vẫn chạy bình thường, chỉ mất phần cache.
    });
  });
}
