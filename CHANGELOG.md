# 📢 LiveSync Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - Improved Ignore Logic 🧹

### 🛠 Fixes & Improvements

- **Enhanced File Ignoring Behavior** → Previously, adding a folder name to the ignore list would ignore only the folder itself and a file with that name (e.g., `dist` would ignore `dist/` and `dist`, but not `dist/file.js`).  
  Now, the ignore logic properly excludes all **files and subfolders** within ignored directories, making it more reliable for cases like `node_modules`, `dist`, etc.
  Glob patterns still work as expected — this update simply improves how folder names are handled when no pattern is used.

---

## [1.0.0] - Initial Release 🚀

### 🎉 Features

- **Real-time Synchronization** → Keep your local and remote folders in sync.
- **Tree View with Diff Status** → See changes at a glance with file status indicators.
- **Customizable Event Actions** → Configure how file events (create, save, delete, move, etc.) are handled.
- **Explorer Context Menu Integration** → Right-click files/folders in the VS Code Explorer to sync manually.
- **Webview Configuration Panel** → Easily configure LiveSync settings via an intuitive UI.
- **File Ignoring via Patterns** → Define glob patterns to exclude specific files/folders from sync.
- **Commands in Explorer & Tree View** → Right-click menu options or use icons to:
  - **Upload** or **Download** files and folders.
  - **Refresh differences** in the tree view.
  - **Show diff** between local and remote files.

### 🛠 Improvements & Fixes

- Optimized SFTP/SSH connection handling.
- Improved performance for large folders.
- Enhanced logging for better debugging.

---

## 🗺️ Future Plans

- Fixing potential bugs and improving stability.
- Listening to user feedback to refine and enhance the extension.

---

📌 **Got feedback or found a bug?**  
Report it here: [GitHub Issues](https://github.com/a-gior/LiveSync/issues)
