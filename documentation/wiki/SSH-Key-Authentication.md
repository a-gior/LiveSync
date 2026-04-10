# 🔐 Using SSH Key Authentication

SSH key authentication is more secure than a password and means you won't need to type credentials every time. This guide walks you through setting it up with LiveSync.

---

## How It Works

You generate a key **pair**: a private key that stays on your machine and a public key that you put on the remote server. When LiveSync connects, the server verifies your private key against the stored public key — no password needed.

---

## Step 1: Generate an SSH Key Pair

If you don't already have one, generate a key pair:

```bash
ssh-keygen -t rsa -b 4096
```

When prompted, you can press Enter to accept the default location:
- **Linux/macOS:** `~/.ssh/id_rsa`
- **Windows:** `C:\Users\YourUser\.ssh\id_rsa`

You can optionally set a **passphrase** for extra security. If you do, you'll need to enter it in LiveSync's config.

---

## Step 2: Add the Public Key to the Remote Server

### Automatic (Linux/macOS)

```bash
ssh-copy-id your-username@your.server.com
```

### Manual

1. Copy the contents of `~/.ssh/id_rsa.pub` (or your `.pub` file).
2. On the remote server, open (or create) `~/.ssh/authorized_keys`.
3. Paste the public key as a new line.
4. Make sure the permissions are correct:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

---

## Step 3: Configure LiveSync

### Via the Configuration Panel

1. Open the Command Palette → **LiveSync: Configure Workspace**.
2. Set **Auth Method** to **SSH Key**.
3. Fill in the **Private Key Path** (e.g., `/home/you/.ssh/id_rsa` or `C:\Users\You\.ssh\id_rsa`).
4. If your key has a passphrase, fill in the **Passphrase** field.
5. Click **Save**.

### Via `.vscode/livesync.json`

```json
{
  "hostname": "your.server.com",
  "port": 22,
  "username": "your-username",
  "password": "",
  "privateKeyPath": "/home/you/.ssh/id_rsa",
  "passphrase": "",
  "remotePath": "/remote/path"
}
```

---

## Step 4: Test the Connection

Click **Test Connection** in the Configuration Panel (or run `LiveSync: Test Connection` from the Command Palette) to verify everything is working before you start syncing.

---

## 🔗 Next Steps

- [⚙️ Configuration](https://github.com/a-gior/LiveSync/wiki/%E2%9A%99%EF%B8%8FConfiguration)
- [⚡ Event Handling & Sync Configuration](https://github.com/a-gior/LiveSync/wiki/%E2%9A%A1Event-Handling-&-Sync-Configuration)
