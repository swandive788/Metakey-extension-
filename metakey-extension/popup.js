// MetaKey - Popup Script

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const domainText = document.getElementById('domainText');
const emailInput = document.getElementById('emailInput');
const saveEmailBtn = document.getElementById('saveEmailBtn');
const savedBadge = document.getElementById('savedBadge');
const fillBtn = document.getElementById('fillBtn');
const pingBtn = document.getElementById('pingBtn');
const showPassBtn = document.getElementById('showPassBtn');
const passwordCard = document.getElementById('passwordCard');
const passwordDisplay = document.getElementById('passwordDisplay');
const copyBtn = document.getElementById('copyBtn');

let currentDomain = null;

function setStatus(state, message) {
  statusDot.className = `dot ${state}`;
  statusText.textContent = message;
}

async function checkWallet() {
  setStatus('checking', 'Checking...');
  const result = await chrome.runtime.sendMessage({ type: 'PING_WALLET' });
  if (result.connected) {
    setStatus('connected', `Connected ✓ (${result.source || 'wallet'})`);
    fillBtn.disabled = false;
    showPassBtn.disabled = false;
  } else {
    setStatus('disconnected', 'Wallet not found');
    fillBtn.disabled = true;
    showPassBtn.disabled = true;
  }
}

async function getCurrentDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    try { return new URL(tab.url).hostname; } catch { return null; }
  }
  return null;
}

async function loadSavedEmail(domain) {
  const key = `email:${domain}`;
  const result = await chrome.storage.local.get(key);
  if (result[key]) {
    emailInput.value = result[key];
    savedBadge.style.display = 'block';
  } else {
    emailInput.value = '';
    savedBadge.style.display = 'none';
  }
}

async function saveEmail() {
  if (!currentDomain) return;
  const email = emailInput.value.trim();
  const key = `email:${currentDomain}`;
  if (email) {
    await chrome.storage.local.set({ [key]: email });
    savedBadge.style.display = 'block';
    saveEmailBtn.textContent = 'Saved!';
    setTimeout(() => saveEmailBtn.textContent = 'Save', 1500);
  } else {
    await chrome.storage.local.remove(key);
    savedBadge.style.display = 'none';
  }
}

async function fillCurrentPage() {
  if (!currentDomain) return;
  fillBtn.disabled = true;
  fillBtn.textContent = 'Deriving...';

  const key = `email:${currentDomain}`;
  const stored = await chrome.storage.local.get(key);
  const emailOverride = stored[key] || null;

  const result = await chrome.runtime.sendMessage({
    type: 'DERIVE_CREDENTIALS',
    domain: currentDomain,
    emailOverride
  });

  if (result.success) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.sendMessage(tab.id, { type: "FILL_CREDENTIALS", credentials: result }, () => { chrome.runtime.lastError; });
      fillBtn.textContent = 'Filled ✓';
    } catch (err) {
      fillBtn.textContent = 'No form found';
    }
  } else {
    fillBtn.textContent = 'Failed';
  }
  setTimeout(() => { fillBtn.textContent = 'Fill Credentials'; fillBtn.disabled = false; }, 2000);
}

async function showPassword() {
  if (!currentDomain) return;
  showPassBtn.disabled = true;
  showPassBtn.textContent = 'Deriving...';

  const result = await chrome.runtime.sendMessage({
    type: 'DERIVE_CREDENTIALS',
    domain: currentDomain,
    emailOverride: null
  });

  if (result.success) {
    passwordDisplay.textContent = result.password;
    passwordCard.style.display = 'block';
    showPassBtn.textContent = 'Hide Password';
    showPassBtn.disabled = false;
    showPassBtn.onclick = () => {
      passwordCard.style.display = 'none';
      showPassBtn.textContent = 'Show Password';
      showPassBtn.onclick = showPassword;
    };
  } else {
    showPassBtn.textContent = 'Failed';
    setTimeout(() => { showPassBtn.textContent = 'Show Password'; showPassBtn.disabled = false; }, 2000);
  }
}

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(passwordDisplay.textContent).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = 'Copy', 1500);
  });
});

// Init
(async () => {
  currentDomain = await getCurrentDomain();
  domainText.textContent = currentDomain || 'No active tab';
  if (currentDomain) await loadSavedEmail(currentDomain);
  await checkWallet();
})();

saveEmailBtn.addEventListener('click', saveEmail);
emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveEmail(); });
pingBtn.addEventListener('click', checkWallet);
fillBtn.addEventListener('click', fillCurrentPage);
showPassBtn.addEventListener('click', showPassword);
