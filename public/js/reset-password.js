(() => {
  const token = new URLSearchParams(location.search).get('token');
  const form = document.getElementById('reset-form');
  const error = document.getElementById('reset-error');
  const button = document.getElementById('reset-button');
  const message = document.getElementById('reset-message');

  if (!token) {
    button.disabled = true;
    error.textContent = 'Reset link invalid ya expire ho gaya hai. Login page se naya link mangayein.';
    error.classList.remove('hidden');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.classList.add('hidden');
    const password = document.getElementById('new-password').value;
    const confirmation = document.getElementById('confirm-password').value;
    if (password !== confirmation) {
      error.textContent = 'Passwords match nahi karte.';
      error.classList.remove('hidden');
      return;
    }

    button.disabled = true;
    try {
      const result = await api('/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      });
      message.textContent = result.message;
      form.classList.add('hidden');
    } catch (ex) {
      error.textContent = ex.message;
      error.classList.remove('hidden');
      button.disabled = false;
    }
  });
})();
