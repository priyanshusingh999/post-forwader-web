(() => {
  const token = new URLSearchParams(location.search).get('token');
  const button = document.getElementById('verify-button');
  const message = document.getElementById('action-message');
  const error = document.getElementById('action-error');

  if (!token) {
    button.disabled = true;
    error.textContent = 'Verification link invalid ya expire ho gaya hai.';
    error.classList.remove('hidden');
  }

  button.onclick = async () => {
    button.disabled = true;
    error.classList.add('hidden');
    try {
      const result = await api('/auth/verify-email', { method: 'POST', body: { token } });
      message.textContent = result.message;
      button.textContent = 'Email verified';
      button.classList.add('hidden');
    } catch (ex) {
      error.textContent = ex.message;
      error.classList.remove('hidden');
      button.disabled = false;
    }
  };
})();
