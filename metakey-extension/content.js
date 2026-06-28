// MetaKey - Content Script
// Detects login forms, handles 2-step flows, bridges window.CWI to background

(function () {
  let state = 'idle';
  let pendingCredentials = null;

  // ── CWI Bridge ──────────────────────────────────────────────────────────────
  // Background worker can't access window.CWI — content script relays it

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CWI_REQUEST') {
      if (!window.CWI) {
        sendResponse({ error: 'CWI not available' });
        return true;
      }
      const { method, args } = message;
      window.CWI[method](...args)
        .then(result => sendResponse({ result }))
        .catch(err => sendResponse({ error: err.message }));
      return true; // async
    }

    if (message.type === 'FILL_CREDENTIALS') {
      fillCredentials(message.credentials);
    }
  });

  // Notify background if CWI is available on this page
  if (window.CWI) {
    chrome.runtime.sendMessage({ type: 'CWI_AVAILABLE' });
  }

  // ── Form Detection & Fill ────────────────────────────────────────────────────

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
      fillField(emailField, credentials.username);
      fillField(passwordField, credentials.password);
      showToast('🔑 MetaKey: credentials filled');
      state = 'idle';
    } else if (emailField && !passwordField) {
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
      if (attempts > 20) { clearInterval(interval); state = 'idle'; }
    }, 200);
  }

  // Auto-detect login form
  let notified = false;
  function checkForLoginForm() {
    if (notified) return;
    const emailField = findEmailField();
    const passwordField = findPasswordField();
    if (emailField || passwordField) {
      notified = true;
      console.log('[MetaKey] Login form detected on:', window.location.hostname);
      chrome.runtime.sendMessage({ type: 'AUTOFILL_READY' });
    }
  }

  setTimeout(() => {
    checkForLoginForm();
    const observer = new MutationObserver(() => checkForLoginForm());
    observer.observe(document.body, { childList: true, subtree: true });
  }, 800);

})();
