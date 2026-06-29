// MetaKey - Background Service Worker
// Wallet fallback chain: window.CWI → localhost:3321 → localhost:2121
// Chain sync for email overrides

let activeWallet = null;
let activePort = null;
let activePath = null;
let cwiTabId = null;

// ── CWI Bridge ───────────────────────────────────────────────────────────────

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

// ── Local Wallet ─────────────────────────────────────────────────────────────

async function localRequest(endpoint, body) {
  const path = activePath ? activePath.replace('getPublicKey', endpoint) : `/${endpoint}`;
  const response = await fetch(`http://localhost:${activePort}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

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
        return { connected: true, publicKey: data.publicKey, source: `MetaNet Desktop (port ${port})` };
      }
    } catch (err) {}
  }
  return null;
}

// ── Ping Wallet ──────────────────────────────────────────────────────────────

async function pingWallet(tabId) {
  try {
    const result = await cwiRequest('getPublicKey', [{ identityKey: true }], tabId);
    if (result?.publicKey) {
      activeWallet = 'cwi';
      if (tabId) cwiTabId = tabId;
      return { connected: true, publicKey: result.publicKey, source: 'MetaNet Explorer' };
    }
  } catch (err) {}

  for (const port of [3321, 2121]) {
    const result = await tryLocalPort(port);
    if (result) {
      activeWallet = 'local';
      return result;
    }
  }
  return { connected: false, error: 'No wallet found.' };
}

// ── Wallet Call (unified) ────────────────────────────────────────────────────

async function walletCall(method, args, tabId) {
  if (activeWallet === 'cwi') {
    return cwiRequest(method, [args], tabId || cwiTabId);
  } else if (activeWallet === 'local') {
    return localRequest(method, args);
  }
  throw new Error('No wallet connected');
}

// ── Credential Derivation ────────────────────────────────────────────────────

async function deriveCredentials(domain, emailOverride, tabId) {
  const message = `metakey:${domain}:v1`;
  const messageBytes = Array.from(new TextEncoder().encode(message));
  const args = {
    data: messageBytes,
    protocolID: [1, 'metakey'],
    keyID: '1',
    description: 'MetaKey credential derivation'
  };

  let hmac = null;
  try {
    const result = await walletCall('createHmac', args, tabId);
    if (result?.hmac) hmac = result.hmac;
  } catch (err) {
    console.error('[MetaKey] HMAC failed:', err.message);
  }

  if (!hmac) return { success: false, error: 'Could not derive credentials' };

  const password = hmacToPassword(hmac);
  const username = emailOverride || hmacToUsername(hmac);
  return { success: true, username, password, domain };
}


// ── Chain Sync ───────────────────────────────────────────────────────────────

async function saveEmailToChain(domain, email, tabId) {
  try {
    console.log('[MetaKey] saveEmailToChain called, activeWallet:', activeWallet, 'tabId:', tabId);
    const plaintext = JSON.stringify({ domain, email, v: 1 });
    const plaintextBytes = Array.from(new TextEncoder().encode(plaintext));

    console.log('[MetaKey] Getting identity key...');
    const keyResult = await walletCall('getPublicKey', { identityKey: true }, tabId);
    console.log('[MetaKey] Identity key result:', JSON.stringify(keyResult));
    if (!keyResult?.publicKey) throw new Error('Could not get identity key');

    // Encrypt using 'self' as counterparty
    const encrypted = await walletCall('encrypt', {
      plaintext: plaintextBytes,
      protocolID: [1, 'metakey emails'],
      keyID: '1',
      counterparty: 'self',
      description: `Save MetaKey email for ${domain}`
    }, tabId);

    console.log('[MetaKey] Encrypt result:', JSON.stringify(encrypted));
    if (!encrypted?.ciphertext) throw new Error('Encryption failed: ' + JSON.stringify(encrypted));

    const prefix = Array.from(new TextEncoder().encode('metakey'));
    const cipherBytes = Array.from(encrypted.ciphertext);

    function pushData(bytes) {
      if (bytes.length < 76) return [bytes.length, ...bytes];
      else if (bytes.length < 256) return [0x4c, bytes.length, ...bytes];
      else return [0x4d, bytes.length & 0xff, (bytes.length >> 8) & 0xff, ...bytes];
    }

    const scriptBytes = [0x00, 0x6a, ...pushData(prefix), ...pushData(cipherBytes)];
    const lockingScript = scriptBytes.map(b => b.toString(16).padStart(2, '0')).join('');

    const result = await walletCall('createAction', {
      description: `MetaKey: save email for ${domain}`,
      outputs: [{
        lockingScript,
        satoshis: 0,
        outputDescription: `MetaKey email for ${domain}`,
        tags: ['metakey-email']
      }],
      labels: ['metakey']
    }, tabId);

    console.log('[MetaKey] Saved to chain:', result?.txid);
    return { success: true, txid: result?.txid };
  } catch (err) {
    console.error('[MetaKey] Chain save failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function loadEmailsFromChain(tabId) {
  try {
    const result = await walletCall('listActions', {
      labels: ['metakey'],
      includeOutputs: true,
      includeOutputLockingScripts: true,
      limit: 100
    }, tabId);

    if (!result?.actions) return {};

    const emails = {};
    for (const action of result.actions) {
      try {
        for (const output of (action.outputs || [])) {
          if (!output.lockingScript) continue;

          const scriptHex = output.lockingScript;
          const scriptBytes = [];
          for (let i = 0; i < scriptHex.length; i += 2) {
            scriptBytes.push(parseInt(scriptHex.substr(i, 2), 16));
          }

          if (scriptBytes[0] !== 0x00 || scriptBytes[1] !== 0x6a) continue;

          let pos = 2;
          let prefixLen;
          if (scriptBytes[pos] < 0x4c) { prefixLen = scriptBytes[pos++]; }
          else if (scriptBytes[pos] === 0x4c) { pos++; prefixLen = scriptBytes[pos++]; }
          else { pos++; prefixLen = scriptBytes[pos] | (scriptBytes[pos+1] << 8); pos += 2; }
          pos += prefixLen;

          if (pos >= scriptBytes.length) continue;

          let cipherLen;
          if (scriptBytes[pos] < 0x4c) { cipherLen = scriptBytes[pos++]; }
          else if (scriptBytes[pos] === 0x4c) { pos++; cipherLen = scriptBytes[pos++]; }
          else { pos++; cipherLen = scriptBytes[pos] | (scriptBytes[pos+1] << 8); pos += 2; }

          const cipherBytes = scriptBytes.slice(pos, pos + cipherLen);
          if (cipherBytes.length === 0) continue;

          const decrypted = await walletCall('decrypt', {
            ciphertext: cipherBytes,
            protocolID: [1, 'metakey emails'],
            keyID: '1',
            counterparty: 'self',
            description: 'Load MetaKey emails'
          }, tabId);

          if (decrypted?.plaintext) {
            const text = new TextDecoder().decode(new Uint8Array(decrypted.plaintext));
            const record = JSON.parse(text);
            if (record.domain && record.email) {
              emails[record.domain] = record.email;
            }
          }
        }
      } catch (e) {
        console.log('[MetaKey] Failed to parse action:', e.message);
      }
    }

    console.log('[MetaKey] Loaded from chain:', Object.keys(emails).length, 'sites');
    return emails;
  } catch (err) {
    console.error('[MetaKey] Chain load failed:', err.message);
    return {};
  }
}
// ── Helpers ──────────────────────────────────────────────────────────────────

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

  if (message.type === 'SAVE_EMAIL_CHAIN') {
    saveEmailToChain(message.domain, message.email, tabId).then(sendResponse);
    return true;
  }

  if (message.type === 'LOAD_EMAILS_CHAIN') {
    loadEmailsFromChain(tabId).then(sendResponse);
    return true;
  }

  if (message.type === 'AUTOFILL_READY') {
    const domain = new URL(sender.tab.url).hostname;
    const key = `email:${domain}`;

    const doFill = async () => {
      // Ensure wallet is connected before trying to derive
      if (!activeWallet) {
        await pingWallet(tabId);
      }
      if (!activeWallet) return; // still not connected, skip autofill

      const stored = await new Promise(resolve => chrome.storage.local.get(key, resolve));
      const emailOverride = stored[key] || null;
      const credentials = await deriveCredentials(domain, emailOverride, tabId);
      if (credentials && credentials.success) {
        chrome.tabs.sendMessage(sender.tab.id, { type: 'FILL_CREDENTIALS', credentials }, () => { chrome.runtime.lastError; });
      }
    };

    doFill();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[MetaKey] Extension installed');
  pingWallet(null).then(result => {
    console.log('[MetaKey] Initial wallet check:', result);
  });
});
