// MetaKey - Content Script
// Detects login forms, handles both single-step and 2-step flows

(function () {
  let state = 'idle'; // idle | email_filled | waiting_for_password
  let pendingCredentials = null;

  function findEmailField() {
    return document.querySelector(
      'input[type="email"], input[autocomplete="email"], input[autocomplete="username"], ' +
      'input[name*="email" i], input[name*="user" i], input[id*="email" i], input[placeholder*="email" i]'
    );
  }

  function findPasswordField() {
    return document.querySelector('input[type="password"]');
  }

  function findSubmitButton() {
    // Look for continue/next/submit buttons near the form
    const candidates = [
      ...document.querySelectorAll('button[type="submit"]'),
      ...document.querySelectorAll('button'),
      ...document.querySelectorAll('input[type="submit"]')
    ];
    const keywords = /continue|next|sign in|log in|submit|proceed/i;
    return candidates.find(b => keywords.test(b.textContent) || keywords.test(b.value)) || candidates[0];
  }

  function fillField(field, value) {
    if (!field) return;
    field.focus();
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  function showToast(message) {
    const existing = document.getElementById('metakey-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'metakey-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px;
      background: #1a1a2e; color: #e0e0ff;
      font-family: monospace; font-size: 13px;
      padding: 10px 16px; border-radius: 6px;
      border: 1px solid #4a4aff; z-index: 999999;
      box-shadow: 0 4px 20px rgba(74,74,255,0.3);
      transition: opacity 0.3s;
    `;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
  }

  function fillCredentials(credentials) {
    pendingCredentials = credentials;
    const emailField = findEmailField();
    const passwordField = findPasswordField();

    if (emailField && passwordField) {
      // Single-step form — fill both immediately
      fillField(emailField, credentials.username);
      fillField(passwordField, credentials.password);
      showToast('🔑 MetaKey: credentials filled');
      state = 'idle';
    } else if (emailField && !passwordField) {
      // 2-step form — fill email and click continue
      fillField(emailField, credentials.username);
      showToast('🔑 MetaKey: email filled, continuing...');
      state = 'email_filled';

      setTimeout(() => {
        const btn = findSubmitButton();
        if (btn) {
          btn.click();
          state = 'waiting_for_password';
          waitForPasswordField();
        }
      }, 400);
    } else if (!emailField && passwordField) {
      // Already on password step
      fillField(passwordField, credentials.password);
      showToast('🔑 MetaKey: password filled');
      state = 'idle';
    }
  }

  function waitForPasswordField() {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const passwordField = findPasswordField();
      if (passwordField && pendingCredentials) {
        clearInterval(interval);
        fillField(passwordField, pendingCredentials.password);
        showToast('🔑 MetaKey: password filled');
        state = 'idle';
        pendingCredentials = null;
      }
      if (attempts > 20) { // 4 seconds timeout
        clearInterval(interval);
        state = 'idle';
      }
    }, 200);
  }

  // Listen for fill command from background/popup
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'FILL_CREDENTIALS') {
      fillCredentials(message.credentials);
    }
  });

  // Auto-detect login form on page load
  function checkForLoginForm() {
    const emailField = findEmailField();
    const passwordField = findPasswordField();
    if (emailField || passwordField) {
      console.log('[MetaKey] Login form detected on:', window.location.hostname);
      chrome.runtime.sendMessage({ type: 'AUTOFILL_READY' });
    }
  }

  // Watch for dynamically injected forms (SPAs)
  let notified = false;
  const observer = new MutationObserver(() => {
    if (!notified) {
      const emailField = findEmailField();
      const passwordField = findPasswordField();
      if (emailField || passwordField) {
        notified = true;
        chrome.runtime.sendMessage({ type: 'AUTOFILL_READY' });
      }
    }
  });

  setTimeout(() => {
    checkForLoginForm();
    observer.observe(document.body, { childList: true, subtree: true });
  }, 800);

})();
