/**
 * Khoá phóng to / thu nhỏ trang trên điện thoại.
 *
 * VÌ SAO CẦN FILE NÀY, thẻ meta chưa đủ: mọi trang đều đã có
 *   <meta name="viewport" content="... maximum-scale=1, user-scalable=no">
 * nhưng **Safari trên iOS bỏ qua cả `user-scalable=no` lẫn `maximum-scale`** từ iOS 10 —
 * Apple cố tình gỡ quyền đó của trang web vì lý do trợ năng. Nên trên iPhone (thiết bị chính
 * của chủ app) chụm hai ngón vẫn phóng to được ở MỌI trang, kể cả trang giải đấu. Mấy màn
 * hình game "có vẻ" không zoom được chỉ vì chúng `position: fixed` toàn màn hình nên không
 * có gì để kéo, chứ chụm ngón vẫn ăn.
 *
 * Cách duy nhất còn tác dụng trên iOS là chặn tay:
 *  - `gesturestart/change/end` — sự kiện riêng của Safari, phát khi bắt đầu chụm ngón.
 *  - `touchmove` từ 2 ngón trở lên — dự phòng cho trình duyệt không có `gesture*`.
 *  - `dblclick` — chặn nhấn đúp phóng to (phần còn lại do `touch-action` trong CSS lo).
 *
 * KHÔNG chặn Ctrl + lăn chuột: đó là zoom trên máy tính, người dùng chủ động và cần thật.
 *
 * Giới hạn phải nói rõ: đây là chặn cử chỉ trong trang. Người dùng vẫn phóng to được qua
 * Cài đặt > Trợ năng của iOS, và đó là đúng — không nên và không thể khoá tuyệt đối.
 */
(() => {
  const stop = (event) => event.preventDefault();

  // Safari (iOS + macOS): ba sự kiện này bắn ra khi chụm hai ngón.
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, stop, { passive: false });
  }

  // Dự phòng: chạm từ 2 ngón trở lên thì không cho trình duyệt xử lý tiếp.
  // `passive: false` là bắt buộc — không có nó thì preventDefault bị bỏ qua.
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false },
  );

  document.addEventListener('dblclick', stop, { passive: false });
})();
