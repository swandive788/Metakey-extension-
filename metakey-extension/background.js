// MetaKey - Background Service Worker
// Wallet fallback chain: window.CWI → localhost:3321 → localhost:2121

let activeWallet = null; // 'cwi' | 'local'
let activePort = null;
let activePath = null;
let cwiTabId = null; // tab where CWI was detected

// ── CWI (MetaNet Explorer) ───────────────────────────────────────────────────

async function cwiRequest(method, args, tabId) {
  return new Promise((resolve, reject) => {
    const target = tabId || cwiTabId;
    if (!target) return reject(new Error('No CWI tab'));
    chrome.tabs.sendMessage(target, { type: 'CWI_REQUEST', method, args }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.error) return reject(new Error(response.error));
      resolve(response?.result);
    });
  });
}

// ── Local Wallet (MetaNet Desktop / BSV Desktop) ─────────────────────────────

async function tryLocalPort(port) {
  const endpoints = ['/getPublicKey', '/v1/getPublicKey'];
  for (const ep of endpoints) {
    try {
      const response = await fetch(`http://localhost:${port}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityKey: true })
      });
      const data = await response.json();
      if (data.publicKey) {
        console.log(`[MetaKey] Local wallet connected on port ${port} at ${ep}`);
        activePort = port;
        activePath = ep;
        return { connected: true, publicKey: data.publicKey, source: 'local', port };
      }
    } catch (err) {
      // try next
    }
  }
  return null;
}

// ── Ping Wallet (tries all sources) ─────────────────────────────────────────

async function pingWallet(tabId) {
  // 1. Try CWI first
  try {
    const result = await cwiRequest('getPublicKey', [{ identityKey: true }], tabId);
    if (result?.publicKey) {
      console.log('[MetaKey] CWI wallet connected. Identity key:', result.publicKey);
      activeWallet = 'cwi';
      if (tabId) cwiTabId = tabId;
      return { connected: true, publicKey: result.publicKey, source: 'MetaNet Explorer' };
    }
  } catch (err) {
    console.log('[MetaKey] CWI not available:', err.message);
  }

  // 2. Try local ports
  for (const port of [3321, 2121]) {
    const result = await tryLocalPort(port);
    if (result) {
      activeWallet = 'local';
      return { ...result, source: `MetaNet Desktop (port ${port})` };
    }
  }

  return { connected: false, error: 'No wallet found. Open MetaNet Explorer or MetaNet Desktop.' };
}

// ── Derive Credentials ───────────────────────────────────────────────────────

async function deriveCredentials(domain, emailOverride, tabId) {
  const message = `metakey:${domain}:v1`;
  const messageBytes = Array.from(new TextEncoder().encode(message));
  const args = [{
    data: messageBytes,
    protocolID: [1, 'metakey'],
    keyID: '1',
    description: 'MetaKey credential derivation'
  }];

  let hmac = null;

  if (activeWallet === 'cwi') {
    try {
      const result = await cwiRequest('createHmac', args, tabId);
      if (result?.hmac) hmac = result.hmac;
    } catch (err) {
      console.error('[MetaKey] CWI HMAC failed:', err.message);
    }
  }

  if (!hmac && activeWallet === 'local' && activePort) {
    try {
      const hmacPath = activePath.replace('getPublicKey', 'createHmac');
      const response = await fetch(`http://localhost:${activePort}${hmacPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args[0])
      });
      const data = await response.json();
      if (data.hmac) hmac = data.hmac;
    } catch (err) {
      console.error('[MetaKey] Local HMAC failed:', err.message);
    }
  }

  if (!hmac) {
    // Try to ping and retry once
    await pingWallet(tabId);
    return { success: false, error: 'Could not derive credentials — wallet not connected' };
  }

  const password = hmacToPassword(hmac);
  const username = emailOverride || hmacToUsername(hmac);
  console.log('[MetaKey] Credentials derived for:', domain, '| email override:', !!emailOverride);
  return { success: true, username, password, domain };
}

function hmacToPassword(bytes) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 17; i++) password += chars[bytes[i] % chars.length];
  password += String.fromCharCode(65 + (bytes[17] % 26));
  password += String.fromCharCode(48 + (bytes[18] % 10));
  password += '!';
  return password;
}

function hmacToUsername(bytes) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let name = '';
  for (let i = 0; i < 12; i++) name += chars[bytes[i] % chars.length];
  return name;
}

// ── Message Handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id || null;

  if (message.type === 'CWI_AVAILABLE') {
    cwiTabId = tabId;
    console.log('[MetaKey] CWI detected on tab:', tabId);
    return;
  }

  if (message.type === 'PING_WALLET') {
    pingWallet(tabId).then(sendResponse);
    return true;
  }

  if (message.type === 'DERIVE_CREDENTIALS') {
    deriveCredentials(message.domain, message.emailOverride || null, tabId).then(sendResponse);
    return true;
  }

  if (message.type === 'AUTOFILL_READY') {
    const domain = new URL(sender.tab.url).hostname;
    const key = `email:${domain}`;
    chrome.storage.local.get(key, (stored) => {
      const emailOverride = stored[key] || null;
      deriveCredentials(domain, emailOverride, tabId).then(credentials => {
        chrome.tabs.sendMessage(sender.tab.id, { type: 'FILL_CREDENTIALS', credentials });
      });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[MetaKey] Extension installed');
  pingWallet(null).then(result => {
    console.log('[MetaKey] Initial wallet check:', result);
  });
});
