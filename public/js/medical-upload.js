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
