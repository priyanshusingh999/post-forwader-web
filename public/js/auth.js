(async () => {
  // Pehle se login hai to seedha dashboard
  try {
    await api('/me');
    location.replace('/dashboard.html');
    return;
  } catch {}

  let mode = 'login';
  const $ = (id) => document.getElementById(id);

  function setMode(m) {
    mode = m;
    $('tab-login').classList.toggle('active', m === 'login');
    $('tab-register').classList.toggle('active', m === 'register');
    $('name-wrap').classList.toggle('hidden', m === 'login');
    $('submit').textContent = m === 'login' ? 'Login' : 'Account banao';
    $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('error').textContent = '';
  }
  $('tab-login').onclick = () => setMode('login');
  $('tab-register').onclick = () => setMode('register');

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('error').textContent = '';
    $('submit').disabled = true;
    try {
      const body = { email: $('email').value, password: $('password').value };
      if (mode === 'register') body.name = $('name').value;
      await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body });
      location.replace('/dashboard.html');
    } catch (err) {
      $('error').textContent = err.message;
    } finally {
      $('submit').disabled = false;
    }
  });
})();
