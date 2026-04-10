# 🖱️ Explorer Context Menu Commands

LiveSync integrates with **VS Code's Explorer** so you can sync files and folders directly — no need to open the Tree View.

---

## 📌 Available Commands

Right-click any file or folder in the **Explorer** to access LiveSync commands.

### File actions

| Command | Description |
|---|---|
| **Upload** | Send the local file to the remote server |
| **Download** | Fetch the remote file and replace the local one |
| **Show Diff** | Open a side-by-side comparison of local vs. remote |

Upload and download respect your `actionOnUpload` / `actionOnDownload` settings — if those use `check&`, a conflict check runs first.

### Folder actions

| Command | Description |
|---|---|
| **Upload Folder** | Upload all files in the folder to the remote |
| **Download Folder** | Download all remote files in the folder |

---

## 💡 Tip

These commands are also available in the **LiveSync Tree View**, where you can see the full sync status of every file before acting on it.

---

## 🔗 Related Pages

- [📂 Using the Tree View](https://github.com/a-gior/LiveSync/wiki/%F0%9F%93%82-Using-the-Tree-View)
- [⚡ Event Handling & Sync Configuration](https://github.com/a-gior/LiveSync/wiki/%E2%9A%A1Event-Handling-&-Sync-Configuration)
