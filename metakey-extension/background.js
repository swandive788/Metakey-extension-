// MetaKey - Background Service Worker
// Communicates with MetaNet Desktop via JSON-API on localhost:3321

const WALLET_URL = 'http://localhost:3321';
let activePort = 3321;
let activePath = '/getPublicKey';

async function tryPing(port) {
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
        console.log(`[MetaKey] Connected on port ${port} at ${ep}`);
        console.log('[MetaKey] Identity key:', data.publicKey);
        activePort = port;
        activePath = ep;
        return { connected: true, publicKey: data.publicKey, port, path: ep };
      }
    } catch (err) {
      console.log(`[MetaKey] Port ${port} ${ep} failed:`, err.message);
    }
  }
  return null;
}

async function pingWallet() {
  for (const port of [3321, 2121]) {
    const result = await tryPing(port);
    if (result) return result;
  }
  return { connected: false, error: 'Could not reach wallet on ports 3321 or 2121' };
}

async function deriveCredentials(domain, emailOverride) {
  const message = `metakey:${domain}:v1`;
  const messageBytes = Array.from(new TextEncoder().encode(message));
  const hmacPath = activePath.replace('getPublicKey', 'createHmac');

  try {
    const response = await fetch(`http://localhost:${activePort}${hmacPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: messageBytes,
        protocolID: [1, 'metakey'],
        keyID: '1',
        description: 'MetaKey credential derivation'
      })
    });
    const data = await response.json();

    if (data.hmac) {
      const password = hmacToPassword(data.hmac);
      // Use saved email override, or fall back to derived username
      const username = emailOverride || hmacToUsername(data.hmac);
      console.log('[MetaKey] Credentials derived for:', domain, '| email override:', !!emailOverride);
      return { success: true, username, password, domain };
    } else {
      console.error('[MetaKey] HMAC failed:', data);
      return { success: false, error: JSON.stringify(data) };
    }
  } catch (err) {
    console.error('[MetaKey] Derive error:', err.message);
    return { success: false, error: err.message };
  }
}

function hmacToPassword(bytes) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 17; i++) {
    password += chars[bytes[i] % chars.length];
  }
  password += String.fromCharCode(65 + (bytes[17] % 26));
  password += String.fromCharCode(48 + (bytes[18] % 10));
  password += '!';
  return password;
}

function hmacToUsername(bytes) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let name = '';
  for (let i = 0; i < 12; i++) {
    name += chars[bytes[i] % chars.length];
  }
  return name;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING_WALLET') {
    pingWallet().then(sendResponse);
    return true;
  }

  if (message.type === 'DERIVE_CREDENTIALS') {
    deriveCredentials(message.domain, message.emailOverride || null).then(sendResponse);
    return true;
  }

  if (message.type === 'AUTOFILL_READY') {
    const domain = new URL(sender.tab.url).hostname;
    // Get saved email override for this domain
    const key = `email:${domain}`;
    chrome.storage.local.get(key, (stored) => {
      const emailOverride = stored[key] || null;
      deriveCredentials(domain, emailOverride).then(credentials => {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'FILL_CREDENTIALS',
          credentials
        });
      });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[MetaKey] Extension installed');
  pingWallet().then(result => {
    console.log('[MetaKey] Initial wallet check:', result);
  });
});
