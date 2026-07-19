/**
 * Nút "Lưu thay đổi" của từng đơn thuốc chỉ sáng khi có sửa thật.
 * So với giá trị lúc trang vừa tải, nên sửa rồi sửa về như cũ thì nút tắt lại.
 *
 * Phải duyệt form.elements chứ KHÔNG phải form.querySelectorAll: ở trang tủ thuốc thẻ
 * <form> rỗng, mọi ô và cả nút lưu đều nằm ngoài và gắn vào bằng thuộc tính form="...".
 * querySelector chỉ tìm con cháu -> không thấy gì -> nút lưu kẹt disabled vĩnh viễn.
 */
(() => {
  document.querySelectorAll('[data-med-items]').forEach((form) => {
    const members = [...form.elements];
    const save = members.find((el) => el.dataset && el.dataset.medSave !== undefined);
    if (!save) return;
    const fields = members.filter((el) => el.tagName === 'INPUT');
    const initial = fields.map((field) => (field.type === 'checkbox' ? field.checked : field.value));
    const refresh = () => {
      const dirty = fields.some((field, i) => (field.type === 'checkbox' ? field.checked : field.value) !== initial[i]);
      save.disabled = !dirty;
    };
    // Nghe trên từng ô, không nghe trên form: sự kiện nổi bọt theo cây DOM chứ không
    // theo thuộc tính form=, nên ô nằm ngoài thẻ <form> sẽ không bao giờ chạm tới form.
    fields.forEach((field) => {
      field.addEventListener('input', refresh);
      field.addEventListener('change', refresh);
    });
  });
})();

(() => {
  const form = document.querySelector('[data-medical-upload]');
  if (!form) return;
  const fileInput = form.querySelector('[data-image-file]');
  const dataInput = form.querySelector('[data-image-data]');
  const mimeInput = form.querySelector('[data-image-mime]');
  const preview = form.querySelector('[data-image-preview]');
  const submit = form.querySelector('[data-image-submit]');
  const MAX = 1400; // cạnh dài tối đa để giảm dung lượng gửi lên

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      dataInput.value = '';
      submit.disabled = true;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        dataInput.value = dataUrl;
        mimeInput.value = 'image/jpeg';
        preview.src = dataUrl;
        preview.classList.remove('hidden');
        submit.disabled = false;
      };
      img.onerror = () => {
        // Ảnh không đọc được bằng canvas (vd HEIC): gửi nguyên bản.
        dataInput.value = reader.result;
        mimeInput.value = file.type || 'image/jpeg';
        submit.disabled = false;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
})();

/**
 * Nút điền nhanh số lượng mua ("mua thêm 3" / "mua đủ 10").
 * Phải bắn sự kiện input thủ công: gán .value bằng script KHÔNG tự sinh sự kiện, mà nút
 * "Lưu thay đổi" chỉ sáng khi nghe được input -> không bắn thì bấm xong không lưu được.
 */
(() => {
  document.querySelectorAll('[data-fill-buy]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = document.getElementsByName(button.dataset.fillBuy)[0];
      if (!field) return;
      field.value = button.dataset.fillValue;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.focus();
    });
  });
})();
