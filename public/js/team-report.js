/**
 * Nút "Lưu ảnh" ở trang báo cáo tháng đội bóng (chủ app 29/9/2026): vẽ lại bảng #teamReportTable thành
 * ảnh PNG bằng canvas rồi đưa cho người dùng. Vẽ tay chứ không dùng thư viện chụp DOM vì CSP
 * script-src 'self' — mọi thứ phải nằm trong public/js — và bảng chỉ có chữ, số, dấu ✓/✗ nên vẽ tay
 * gọn hơn kéo cả một thư viện 200KB về.
 *
 * Dữ liệu lấy từ data-amount / data-paid trên từng ô (view ghi sẵn), không đọc textContent để khỏi dính
 * chữ trong huy hiệu. Điện thoại có bảng chia sẻ (navigator.share với file) thì mở thẳng — iPhone bấm
 * "Lưu vào Ảnh"; không có thì tải file về.
 */
(() => {
  const button = document.getElementById('teamReportSave');
  const table = document.getElementById('teamReportTable');
  if (!button || !table) return;

  const COLOR = { ink: '#14161c', muted: '#6b7280', line: '#e5e7eb', head: '#f5f4ef', ok: '#16a34a', no: '#dc2626', paper: '#ffffff' };
  const FONT = "'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', sans-serif";

  const readTable = () => {
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')]
      .map((tr) => [...tr.querySelectorAll('td')])
      .filter((cells) => cells.length === headers.length)
      .map((cells) => cells.map((td) => ({ text: td.dataset.amount ?? td.textContent.trim(), paid: td.dataset.paid })));
    const foot = [...table.querySelectorAll('tfoot td')].map((td) => ({ text: td.dataset.amount ?? td.textContent.trim(), paid: undefined }));
    return { title: table.dataset.title || 'Báo cáo', headers, rows, foot };
  };

  const drawMark = (ctx, x, y, ok) => {
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = ok ? COLOR.ok : COLOR.no;
    ctx.fill();
    ctx.strokeStyle = COLOR.paper;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (ok) {
      ctx.moveTo(x - 4.5, y + 0.5);
      ctx.lineTo(x - 1.5, y + 3.5);
      ctx.lineTo(x + 4.5, y - 3.5);
    } else {
      ctx.moveTo(x - 3.5, y - 3.5);
      ctx.lineTo(x + 3.5, y + 3.5);
      ctx.moveTo(x + 3.5, y - 3.5);
      ctx.lineTo(x - 3.5, y + 3.5);
    }
    ctx.stroke();
  };

  const render = () => {
    const data = readTable();
    const cols = data.headers.length;
    const widths = data.headers.map((_, index) => (index === 0 ? 230 : index === cols - 1 ? 210 : 170));
    const width = widths.reduce((sum, w) => sum + w, 0) + 40;
    const rowH = 44;
    const headH = 48;
    const top = 76;
    const height = top + headH + rowH * (data.rows.length + 1) + 28;
    const scale = Math.min(3, window.devicePixelRatio || 1) * 1.5;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = COLOR.paper;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = COLOR.ink;
    ctx.font = `700 22px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(data.title, 20, 32);
    ctx.font = `400 13px ${FONT}`;
    ctx.fillStyle = COLOR.muted;
    ctx.fillText(`Chỉ thành viên cố định · ✓ đã đóng · ✗ chưa đóng · ${new Date().toLocaleDateString('vi-VN')}`, 20, 56);

    // Đầu bảng.
    let y = top;
    ctx.fillStyle = COLOR.head;
    ctx.fillRect(20, y, width - 40, headH);
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = COLOR.ink;
    let x = 20;
    data.headers.forEach((text, index) => {
      const align = index === 0 ? 'left' : index === cols - 1 ? 'right' : 'center';
      ctx.textAlign = align;
      const tx = align === 'left' ? x + 12 : align === 'right' ? x + widths[index] - 12 : x + widths[index] / 2;
      ctx.fillText(text, tx, y + headH / 2, widths[index] - 24);
      x += widths[index];
    });
    y += headH;

    const drawRow = (cells, bold) => {
      ctx.strokeStyle = COLOR.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(20, y + rowH);
      ctx.lineTo(width - 20, y + rowH);
      ctx.stroke();
      let cx = 20;
      cells.forEach((cell, index) => {
        const align = index === 0 ? 'left' : index === cols - 1 ? 'right' : 'center';
        ctx.font = `${bold || index === 0 || index === cols - 1 ? 700 : 400} 14px ${FONT}`;
        ctx.fillStyle = COLOR.ink;
        ctx.textAlign = align;
        // Chừa chỗ cho dấu ✓/✗ bên phải số tiền.
        const hasMark = cell.paid === '1' || cell.paid === '0';
        const markW = hasMark ? 26 : 0;
        const tx = align === 'left' ? cx + 12 : align === 'right' ? cx + widths[index] - 12 - markW : cx + widths[index] / 2 - markW / 2;
        ctx.fillText(cell.text, tx, y + rowH / 2, widths[index] - 24 - markW);
        if (hasMark) {
          const textW = Math.min(ctx.measureText(cell.text).width, widths[index] - 24 - markW);
          const mx = align === 'right' ? cx + widths[index] - 12 - 9 : align === 'center' ? tx + textW / 2 + 16 : tx + textW + 16;
          drawMark(ctx, mx, y + rowH / 2, cell.paid === '1');
        }
        cx += widths[index];
      });
      y += rowH;
    };
    data.rows.forEach((cells) => drawRow(cells, false));
    if (data.foot.length === cols) {
      ctx.fillStyle = COLOR.head;
      ctx.fillRect(20, y, width - 40, rowH);
      drawRow(data.foot, true);
    }
    return canvas;
  };

  const fileName = () => `${(table.dataset.title || 'bao-cao').toLowerCase().replace(/\s+/g, '-')}.png`;

  const deliver = async (canvas) => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Không tạo được ảnh');
    const file = new File([blob], fileName(), { type: 'image/png' });
    // Điện thoại: bảng chia sẻ của máy, iPhone có "Lưu vào Ảnh". Người dùng huỷ thì thôi, không tải kép.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: table.dataset.title || 'Báo cáo' });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  button.addEventListener('click', async () => {
    const { setActionLoading, clearActionLoading } = window.Vodich || {};
    if (typeof setActionLoading === 'function') setActionLoading(button, button.dataset.loadingText || 'Đang vẽ...');
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await deliver(render());
    } catch (error) {
      window.alert(error && error.message ? error.message : 'Không lưu được ảnh');
    } finally {
      if (typeof clearActionLoading === 'function') clearActionLoading(button);
    }
  });

  // Cho harness/kiểm thử gọi thẳng, không cần bấm nút.
  window.VodichTeamReport = { render, readTable };
})();
