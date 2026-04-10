# ⚙️ Configuration

Before using LiveSync, you need to configure it with your remote server details and define how sync events behave.

---

## 🛠️ Setup Options

You can configure LiveSync using either:

1. **The Configuration Panel** (recommended — no JSON editing needed)
2. **Manually editing `.vscode/livesync.json`**

---

## 🖥️ Option 1: Use the Configuration Panel (Recommended)

LiveSync provides a visual **Configuration Panel** so you can set up everything without touching any files.

### Steps

1. Open the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **LiveSync: Configure Workspace**.
3. Fill in your remote server details (hostname, port, username, authentication method, etc.).
4. _(Optional)_ Click **Test Connection** to verify before saving.
5. Click **Save** to apply.

You can also open the panel by clicking the **LiveSync icon in the status bar** at the bottom of VS Code.

> **Multi-root workspaces:** LiveSync will first ask which workspace folder to configure.

### How the panel opens

You can control how `Configure Workspace` behaves with the `livesync.openMode` setting:

| Value | Behavior |
|---|---|
| `prompt` | Ask each time whether to open the UI or the JSON file (default) |
| `ui` | Always open the visual panel |
| `json` | Always open `livesync.json` directly |

---

## ✍️ Option 2: Manual `.vscode/livesync.json`

LiveSync stores its workspace connection and sync settings in `.vscode/livesync.json`. You can create or edit this file directly.

### Example

```json
{
  "hostname": "your.server.com",
  "port": 22,
  "username": "your-username",
  "password": "your-password",
  "privateKeyPath": "",
  "passphrase": "",
  "remotePath": "/remote/path/to/sync",

  "actionOnSave": "check&save",
  "actionOnCreate": "check",
  "actionOnDelete": "check",
  "actionOnMove": "check&move",
  "actionOnOpen": "check&download",
  "actionOnUpload": "check&upload",
  "actionOnDownload": "check&download",

  "ignoreList": [
    ".vscode",
    ".git",
    "node_modules"
  ]
}
```

### Connection fields

| Field | Description |
|---|---|
| `hostname` | Remote server address |
| `port` | SSH port (default: 22) |
| `username` | SSH username |
| `password` | Password (leave empty if using SSH key) |
| `privateKeyPath` | Path to your private key file |
| `passphrase` | Passphrase for the private key (if any) |
| `remotePath` | Absolute path on the remote server to sync with |

### Sync event fields

Each `actionOn*` field controls what LiveSync does when that event happens. See [Event Handling & Sync Configuration](https://github.com/a-gior/LiveSync/wiki/%E2%9A%A1Event-Handling-&-Sync-Configuration) for all available values and details.

### Ignore list

`ignoreList` accepts glob patterns for files and folders to exclude from sync. Examples:

```json
"ignoreList": [".git", "node_modules", "*.log", "dist/"]
```

---

## 🔧 VS Code Extension Settings

These settings are in your VS Code user or workspace settings (not `livesync.json`). You can set them in **Settings** (`Ctrl+,`) or in `.vscode/settings.json`.

| Setting | Default | Description |
|---|---|---|
| `livesync.openMode` | `prompt` | Controls how `Configure Workspace` opens (`prompt`, `ui`, `json`) |
| `livesync.refreshOnConfigSave` | `true` | Automatically refreshes differences after saving a config file |
| `livesync.remoteIndex.autoRefreshInterval` | `10` | Interval in minutes for background remote index refresh (0 to disable) |
| `livesync.statusBar.visibleItems` | `[messages, permanent, progress, errors]` | Which LiveSync items appear in the status bar |
| `livesync.index.concurrency` | `4` | Number of concurrent operations used during indexing |
| `livesync.view.recentlyResolvedRetentionMs` | `800` | How long (ms) a just-resolved file stays visible when unchanged files are hidden |

---

## 🔐 Authentication

LiveSync supports two authentication methods:

- **Password** – Enter your password in the `password` field.
- **SSH Key** – Leave `password` empty and set `privateKeyPath` to your key file. See [SSH Key Authentication](https://github.com/a-gior/LiveSync/wiki/%F0%9F%94%90-Using-SSH-Key-Authentication) for a full guide.

---

## 🔗 Next Steps

- [⚡ Event Handling & Sync Configuration](https://github.com/a-gior/LiveSync/wiki/%E2%9A%A1Event-Handling-&-Sync-Configuration)
- [📂 Using the Tree View](https://github.com/a-gior/LiveSync/wiki/%F0%9F%93%82-Using-the-Tree-View)
