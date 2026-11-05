(async () => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let mode = 'login';

  function showStatus(message) {
    $('status').textContent = message;
    $('status').classList.remove('hidden');
    $('error').classList.add('hidden');
  }

  function showError(message) {
    $('error').textContent = message;
    $('error').classList.remove('hidden');
    $('status').classList.add('hidden');
  }

  function setMode(nextMode) {
    mode = nextMode;
    const isLogin = mode === 'login';
    const isRegister = mode === 'register';
    const isForgot = mode === 'forgot';
    $('tab-login').classList.toggle('active', isLogin);
    $('tab-register').classList.toggle('active', isRegister);
    $('tab-login').setAttribute('aria-selected', String(isLogin));
    $('tab-register').setAttribute('aria-selected', String(isRegister));
    $('auth-tabs').classList.toggle('hidden', isForgot);
    $('back-login').classList.toggle('hidden', !isForgot);
    $('name-wrap').classList.toggle('hidden', !isRegister);
    $('name').required = isRegister;
    $('password-wrap').classList.toggle('hidden', isForgot);
    $('password').required = !isForgot;
    $('forgot-link').classList.toggle('hidden', !isLogin);
    $('resend-verification').classList.add('hidden');
    $('auth-title').textContent = isLogin ? 'Welcome back' : isRegister ? 'Create your account' : 'Reset your password';
    $('auth-description').textContent = isLogin
      ? 'Sign in to manage your forwarding setup.'
      : isRegister
        ? 'Start routing Telegram posts in just a few steps.'
        : 'We’ll email you a secure link to choose a new password.';
    $('submit').textContent = isLogin ? 'Log in' : isRegister ? 'Create account' : 'Send reset link';
    $('password').autocomplete = isLogin ? 'current-password' : 'new-password';
    $('error').classList.add('hidden');
    $('error').textContent = '';
    $('status').classList.add('hidden');
    $('status').textContent = '';
  }

  $('tab-login').onclick = () => setMode('login');
  $('tab-register').onclick = () => setMode('register');
  $('forgot-link').onclick = () => setMode('forgot');
  $('back-login').onclick = () => setMode('login');

  if (params.get('verified') === '1') {
    showStatus('Email verified. You can now log in.');
    history.replaceState(null, '', '/');
  } else if (params.get('verified') === '0') {
    showError('That verification link is invalid or has expired. Request a new verification email.');
    history.replaceState(null, '', '/');
  }

  try {
    await api('/me');
    location.replace('/dashboard.html');
    return;
  } catch (error) {
    if (error.status !== 401) showError(error.message);
  }

  $('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('error').classList.add('hidden');
    $('status').classList.add('hidden');
    $('resend-verification').classList.add('hidden');
    $('submit').disabled = true;
    try {
      if (mode === 'forgot') {
        const result = await api('/auth/forgot-password', {
          method: 'POST',
          body: { email: $('email').value },
        });
        showStatus(result.message);
        return;
      }

      const body = { email: $('email').value, password: $('password').value };
      if (mode === 'register') body.name = $('name').value;
      const result = await api(mode === 'login' ? '/auth/login' : '/auth/register', {
        method: 'POST',
        body,
      });

      if (mode === 'register') {
        showStatus(result.message);
        $('resend-verification').classList.remove('hidden');
      } else {
        location.replace('/dashboard.html');
      }
    } catch (error) {
      showError(error.message);
      if (error.data?.emailVerificationRequired) {
        $('resend-verification').classList.remove('hidden');
      }
    } finally {
      $('submit').disabled = false;
    }
  });

  $('resend-verification').onclick = async () => {
    $('resend-verification').disabled = true;
    try {
      const result = await api('/auth/resend-verification', {
        method: 'POST',
        body: { email: $('email').value },
      });
      showStatus(result.message);
    } catch (error) {
      showError(error.message);
    } finally {
      $('resend-verification').disabled = false;
    }
  };
})();
