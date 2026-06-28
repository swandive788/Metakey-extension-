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
const savedSitesContainer = document.getElementById('savedSitesContainer');

let currentDomain = null;

function setStatus(state, message) {
  statusDot.className = `dot ${state}`;
  statusText.textContent = message;
}

async function checkWallet() {
  setStatus('checking', 'Checking...');
  let result = { connected: false };
  try { result = await chrome.runtime.sendMessage({ type: 'PING_WALLET' }); } catch(e) {}
  if (result.connected) {
    setStatus('connected', `Connected ✓ (${result.source || 'wallet'})`);
    fillBtn.disabled = false;
    showPassBtn.disabled = false;
    // Load chain emails in background after connecting
    syncFromChain();
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

// Sync emails from chain into local storage
async function syncFromChain() {
  try {
    const chainEmails = await chrome.runtime.sendMessage({ type: 'LOAD_EMAILS_CHAIN' });
    if (chainEmails && Object.keys(chainEmails).length > 0) {
      const toStore = {};
      for (const [domain, email] of Object.entries(chainEmails)) {
        toStore[`email:${domain}`] = email;
      }
      await chrome.storage.local.set(toStore);
      await loadSavedSites();
      // Refresh current domain email if it was updated
      if (currentDomain) await loadSavedEmail(currentDomain);
      console.log('[MetaKey] Synced from chain:', Object.keys(chainEmails).length, 'sites');
    }
  } catch (e) {
    console.log('[MetaKey] Chain sync skipped:', e.message);
  }
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

// Load all saved sites and render as dropdown
async function loadSavedSites() {
  const all = await chrome.storage.local.get(null);
  const sites = Object.keys(all)
    .filter(k => k.startsWith('email:'))
    .map(k => ({ domain: k.replace('email:', ''), email: all[k] }));

  if (sites.length === 0) {
    savedSitesContainer.innerHTML = '<span class="no-sites">No saved sites yet</span>';
    return;
  }

  const select = document.createElement('select');
  select.className = 'domain-select';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = `${sites.length} saved site${sites.length > 1 ? 's' : ''} — pick one`;
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  sites.sort((a, b) => a.domain.localeCompare(b.domain)).forEach(site => {
    const option = document.createElement('option');
    option.value = site.domain;
    option.textContent = site.domain;
    select.appendChild(option);
  });

  select.addEventListener('change', async () => {
    document.getElementById('removeBtn').style.display = 'block';
    const selected = sites.find(s => s.domain === select.value);
    if (selected) {
      currentDomain = selected.domain;
      domainText.textContent = selected.domain;
      emailInput.value = selected.email;
      savedBadge.style.display = 'block';
      passwordCard.style.display = 'none';
    }
  });

  savedSitesContainer.innerHTML = '';
  savedSitesContainer.appendChild(select);
}

async function saveEmail() {
  if (!currentDomain) return;
  const email = emailInput.value.trim();
  const key = `email:${currentDomain}`;

  if (email) {
    // Save locally first (instant)
    await chrome.storage.local.set({ [key]: email });
    savedBadge.style.display = 'block';
    saveEmailBtn.textContent = 'Saving...';

    // Save to chain (async)
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'SAVE_EMAIL_CHAIN',
        domain: currentDomain,
        email
      });
      if (result?.success) {
        saveEmailBtn.textContent = 'Saved ✓';
        console.log('[MetaKey] Saved to chain:', result.txid);
      } else {
        saveEmailBtn.textContent = 'Local ✓';
        console.log('[MetaKey] Chain save failed, local only');
      }
    } catch (e) {
      saveEmailBtn.textContent = 'Local ✓';
    }

    setTimeout(async () => {
      saveEmailBtn.textContent = 'Save';
      await loadSavedSites();
    }, 2000);
  } else {
    await chrome.storage.local.remove(key);
    savedBadge.style.display = 'none';
    await loadSavedSites();
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { type: 'FILL_CREDENTIALS', credentials: result }, () => { chrome.runtime.lastError; });
    fillBtn.textContent = 'Filled ✓';
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
  await loadSavedSites();
  if (currentDomain) await loadSavedEmail(currentDomain);
  await checkWallet();
})();

saveEmailBtn.addEventListener('click', saveEmail);
emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveEmail(); });
pingBtn.addEventListener('click', checkWallet);
fillBtn.addEventListener('click', fillCurrentPage);
showPassBtn.addEventListener('click', showPassword);

// Remove site
const removeBtn = document.getElementById('removeBtn');

async function removeSite(domain) {
  if (!domain) return;
  if (!confirm(`Remove ${domain} from saved sites?`)) return;

  // Remove from local storage
  await chrome.storage.local.remove(`email:${domain}`);

  // Reset UI
  removeBtn.style.display = 'none';
  emailInput.value = '';
  savedBadge.style.display = 'none';
  passwordCard.style.display = 'none';
  if (currentDomain === domain) {
    currentDomain = await getCurrentDomain();
    domainText.textContent = currentDomain || 'No active tab';
  }

  await loadSavedSites();

  // Note: chain records can't be deleted (immutable) but local removal
  // means it won't show in the dropdown or be used for autofill
  console.log('[MetaKey] Removed locally:', domain);
}

removeBtn.addEventListener('click', () => {
  const select = document.querySelector('.domain-select');
  if (select?.value) removeSite(select.value);
});
