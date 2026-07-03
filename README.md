# 🔑 MetaKey

**Identity-Powered Passwords — No vault. No master password. No breach.**

MetaKey is an open source password manager that derives unique, secure passwords for every website directly from your MetaNet identity key. Your credentials are never stored anywhere — they're generated on demand from your cryptographic identity, powered by the BSV blockchain.

---

## How It Works

Traditional password managers store your passwords in a vault. MetaKey doesn't store anything.

Instead, MetaKey asks your MetaNet wallet to perform a cryptographic operation (HMAC) using your identity key and the website's domain name. The result is always the same for the same site — deterministic, reproducible, and unique per domain.

```
Identity Key + "metakey:github.com:v1" → unique password for GitHub
Identity Key + "metakey:chase.com:v1"  → unique password for Chase
```

No storage. No sync. No server. Just math.

---

## Features

- **Autofill** — detects login forms and fills credentials automatically
- **2-step login support** — handles email-first then password flows (Google, Carvana, etc.)
- **Email override** — save your real email per site, stored encrypted on BSV chain
- **Chain sync** — saved emails sync across devices via BSV blockchain
- **Saved sites dropdown** — quick access to all your configured sites
- **Show/copy password** — reveal and copy your derived password at any time
- **Works with MetaNet Desktop and MetaNet Explorer**

---

## Installation

### Chrome Extension (Desktop)

1. Download the latest release zip from [Releases](../../releases)
2. Unzip the file
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer Mode** (top right toggle)
5. Click **Load unpacked** and select the `metakey-extension` folder
6. Make sure **MetaNet Desktop** is running on port 3321

### Web App (Mobile)

Open the MetaKey web app in **MetaNet Explorer** or **BSV Browser**:

👉 [metakey.swandivesolutions.com](#) *(coming soon)*

The web app uses `window.CWI` to connect to your wallet automatically.

---

## Requirements

- Chrome browser (desktop extension)
- [MetaNet Desktop](https://metanet.com) **or** [MetaNet Explorer](https://projectbabbage.com) wallet
- A MetaNet identity key (created during wallet setup)

---

## Security Model

- Your **private key never leaves your wallet** — MetaKey only sees HMAC outputs
- Passwords are **never stored** — derived fresh on every use
- Each site gets a **unique password** — one breach doesn't expose others
- Email overrides are **encrypted on-chain** — only your identity key can decrypt them
- Autofill only triggers on **domains with a saved email** — unknown sites show a prompt

### Derivation Formula

```javascript
// Message
const message = `metakey:${domain}:v1`

// HMAC via wallet (private key never exposed)
const { hmac } = await wallet.createHmac({
  data: messageBytes,
  protocolID: [1, 'metakey'],
  keyID: '1'
})

// Convert to 20-character password
// Characters: a-z A-Z 0-9 !@#$%^&*
// Guaranteed: 1 uppercase, 1 digit, 1 symbol
```

The formula is public by design — security comes from the identity key, not obscurity.

---

## Architecture

```
Chrome Extension
├── background.js    — wallet communication, HMAC derivation, chain sync
├── content.js       — form detection, autofill, 2-step login handling
├── popup.html/js    — user interface
└── manifest.json    — Chrome extension config

Wallet Bridge (in priority order)
1. window.CWI       — MetaNet Explorer (browser extension)
2. localhost:3321    — MetaNet Desktop
3. localhost:2121    — BSV Desktop
```

---

## Contributing

MetaKey is open source and welcomes contributions from the MetaNet community.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Submit a Pull Request

Please open an issue first for major changes so we can discuss the approach.

---

## Roadmap

- [ ] Chrome Web Store publication
- [ ] Native MetaNet Explorer integration
- [ ] Chain pagination for 100+ saved sites
- [ ] iOS/Android native autofill (requires native app)
- [ ] Multiple identity key support
- [ ] Site-specific password rules (max length, special char restrictions)

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Built By

**Swandive Solutions** — building on the MetaNet

- Web: [swandivesolutions.com](https://swandivesolutions.com)
- Splash (BSV dive logbook): [splashdl.com](https://splashdl.com)

---

*Powered by BSV Blockchain and the BRC-100 wallet standard*# Metakey-extension-
MetaNet identity-powered password manager Chrome extension
