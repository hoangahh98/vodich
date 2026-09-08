/**
 * Service worker cho PWA "Vô địch".
 *
 * Lý do tồn tại: Render chạy plan free nên container ngủ sau ~15 phút. Khi mở app từ
 * icon màn hình chính iPhone lúc server đang ngủ dậy, các request phụ (css/js/ảnh)
 * chết trước khi server tỉnh -> trang hiện ra là HTML thô, mất hết giao diện.
 *
 * Chiến lược:
 * - Tài nguyên tĩnh (css/js/icon/logo): stale-while-revalidate. Trả cache ngay để
 *   giao diện luôn có, đồng thời tải bản mới ngầm cho lần mở sau.
 * - Điều hướng (HTML): luôn đi mạng, KHÔNG cache. Trang có dữ liệu theo phiên đăng
 *   nhập, cache lại sẽ hiện nhầm dữ liệu người khác. Mạng chết thì trả trang báo lỗi.
 */
// v3 (9/2026): bỏ Bootstrap, thêm font tự host + motion.js — cache cũ giữ bootstrap.min.css vô dụng.
// Bump số bản khi HTML đổi theo kiểu bản JS cũ không chạy nổi nữa: cache là
// stale-while-revalidate nên lần mở đầu sau khi deploy vẫn dùng JS cũ, mà khung vòng quay mới
// (data-spin-wheel) thì bản spin-draw.js cũ không hiểu. Đổi tên cache là `activate` quét sạch.
const CACHE = 'vodich-static-v3';

// Nạp sẵn ngay khi cài để lần mở đầu tiên từ màn hình chính đã có giao diện.
const PRECACHE = [
  '/css/app.css',
  '/css/games.css',
  '/fonts/bevietnampro-400-vietnamese.woff2',
  '/fonts/bevietnampro-400-latin.woff2',
  '/fonts/bevietnampro-500-vietnamese.woff2',
  '/fonts/bevietnampro-500-latin.woff2',
  '/fonts/bevietnampro-600-vietnamese.woff2',
  '/fonts/bevietnampro-600-latin.woff2',
  '/fonts/bevietnampro-700-vietnamese.woff2',
  '/fonts/bevietnampro-700-latin.woff2',
  '/fonts/bevietnampro-800-vietnamese.woff2',
  '/fonts/bevietnampro-800-latin.woff2',
  '/fonts/oswald-vietnamese.woff2',
  '/fonts/oswald-latin.woff2',
  '/js/app.js',
  '/js/form-controls.js',
  '/js/selection-controls.js',
  '/js/modal-copy.js',
  '/js/realtime.js',
  '/js/motion.js',
  '/js/no-zoom.js',
  '/uploads/logo.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/manifest.json',
];

const STATIC_PATH = /^\/(css|js|icons|fonts)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    // addAll fail toàn bộ nếu 1 file lỗi -> cache từng file để 1 lỗi không phá hết.
    caches.open(CACHE).then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => null)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // socket.io realtime không được cache.
  if (url.pathname.startsWith('/socket.io/')) return;

  const isStatic = STATIC_PATH.test(url.pathname) || url.pathname === '/uploads/logo.png' || url.pathname === '/manifest.json';
  if (!isStatic) return; // HTML và API: để trình duyệt xử lý bình thường.

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      // Có cache thì trả ngay (server ngủ cũng không mất giao diện), cập nhật ngầm.
      return cached || (await network) || new Response('', { status: 504, statusText: 'Offline' });
    }),
  );
});
