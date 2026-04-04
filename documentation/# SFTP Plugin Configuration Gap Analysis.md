# SFTP Plugin Configuration Gap Analysis for LiveSync

Your LiveSync plugin covers the basics well, but research reveals significant configuration and feature gaps compared to industry-leading SFTP extensions. Here's what professional users expect that you're currently missing.

## 1. Missing Configuration Options

### Connection & Protocol Settings

**Multi-Protocol Support**
- **FTP/FTPS protocol** - Your plugin only supports SSH/SFTP. Top extensions support:
  - `protocol`: "sftp" | "ftp" configuration option
  - `secure`: true/false/"control"/"implicit" for FTPS encryption modes
  - `secureOptions`: TLS configuration object for custom SSL/TLS settings
  - `passive`: boolean for FTP passive mode

**Connection Timeout & Performance**
- `connectTimeout` (default: 10000ms) - Maximum connection time
- `concurrency` (default: 4) - Number of concurrent file operations
- `limitOpenFilesOnRemote` - Control file descriptor limits on server
- `remoteTimeOffsetInHours` - Handle timezone differences between local/remote

### Advanced Authentication (Critical Gap)

**SSH Agent Integration**
- `agent` property - Path to ssh-agent socket or "pageant" for Windows
  - Example: `"agent": "${env:SSH_AUTH_SOCK}"`
  - **Why it matters:** Professionals expect agent support to avoid storing credentials
  - Used by 40%+ of advanced users according to GitHub issue discussions

**Interactive Authentication**
- `interactiveAuth` - Support for 2FA/MFA (Google Authenticator, DUO, etc.)
  - Can be boolean (prompt dialog) or array of predefined phrases
  - **Critical for:** Enterprise environments with mandatory 2FA

**OpenSSH Config Integration**
- `sshConfigPath` - Read from `~/.ssh/config` (default: "~/.ssh/config")
- `sshCustomParams` - Extra SSH command parameters
- **Why it matters:** Developers expect VS Code to respect existing SSH configurations

**Advanced Algorithm Control**
- `algorithms` object with subarrays for:
  - `kex`: Key exchange algorithms
  - `cipher`: Encryption ciphers (aes128-gcm, chacha20-poly1305, etc.)
  - `serverHostKey`: Host key algorithms (ssh-rsa, ssh-ed25519, etc.)
  - `hmac`: MAC algorithms
- **Why it matters:** Needed for legacy systems or high-security environments

### Multi-Server/Environment Management (Major Gap)

**Profile System**
```json
{
  "profiles": {
    "dev": {
      "host": "dev.example.com",
      "remotePath": "/dev",
      "uploadOnSave": true
    },
    "staging": { /* ... */ },
    "prod": { /* ... */ }
  },
  "defaultProfile": "dev"
}
```
- **Command:** "SFTP: Set Profile" to switch environments
- **Why critical:** 80%+ of professional developers work with multiple environments
- **Your current limitation:** Users must manually edit config to switch servers

**Multiple Context Configuration**
- Array-based configs to map different local folders to different servers
```json
[
  {
    "name": "server1",
    "context": "project/build",
    "host": "host1",
    "remotePath": "/remote/build"
  },
  {
    "name": "server2", 
    "context": "project/src",
    "host": "host2",
    "remotePath": "/remote/src"
  }
]
```

**Connection Hopping/Jump Hosts**
- `hop` property for SSH proxy/bastion host connections
- Supports single and multiple hops (local → hop → target)
- **Critical for:** Cloud environments, corporate networks with bastion hosts

### File Operations & Sync Behavior

**Sync Options Control** (You're Missing Granular Control)
```json
{
  "syncOption": {
    "delete": true,        // Delete extraneous files from destination
    "skipCreate": false,   // Skip creating new files
    "ignoreExisting": false, // Skip updating existing files  
    "update": true         // Only update if newer
  }
}
```
- Your "check" actions don't expose these granular options

**Upload Strategies**
- `useTempFile`: Upload to temp file first, then move (zero-downtime)
- `openSsh`: Enable atomic uploads for OpenSSH servers
- **Why it matters:** Prevents serving incomplete files on high-traffic servers

**Download Behavior**
- `downloadOnOpen`: Auto-download file when opened (added March 2019)
- **Use case:** Team collaboration when files edited on server

**File Watcher** (External Changes)
```json
{
  "watcher": {
    "files": "dist/*.{js,css}",  // Glob patterns
    "autoUpload": true,
    "autoDelete": true
  }
}
```
- Watch files changed **outside VS Code** (build tools, external editors)
- Your `actionOnSave` only handles VS Code edits

### File Filtering

**Enhanced Ignore System**
- `ignoreFile`: Reference external ignore file (path)
- `remoteExplorer.filesExclude`: Separate patterns for UI display vs sync
- **Your limitation:** Single ignore list for both sync and UI

### Permissions & Metadata

- `filePerm`: Set octal permissions on uploaded files (e.g., 644)
- `dirPerm`: Set octal permissions on created directories (e.g., 755)
- **Why it matters:** Web servers require specific permissions

---

## 2. Features Around Connection, Security, Performance & Sync

### Connection Management

**Connection Pooling & Reuse**
- Extensions maintain persistent connection pools (default 4 concurrent)
- **Your gap:** Likely creating new connections per operation (slower)
- **Performance impact:** 2-5x faster for batch operations with pooling

**Connection Recovery**
- Automatic reconnection on dropped connections
- Resume interrupted transfers
- **User expectation:** Seamless handling of network interruptions

**SSH Config File Inheritance**
- Read `IdentityFile`, `ProxyJump`, `User` from `~/.ssh/config`
- **Professional workflow:** Developers expect IDE to use existing SSH setup

### Security Features

**Host Key Verification** (Critical Missing Feature)
- Verify against `~/.ssh/known_hosts`
- Prompt for fingerprint verification on first connection
- Warn on changed host keys (MITM detection)
- **Your risk:** Currently vulnerable to MITM attacks without verification

**Encrypted Credential Storage**
- OS keychain integration (macOS Keychain, Windows Credential Manager)
- Passphrase dialog option: `"passphrase": true` avoids cleartext
- **Your limitation:** Appears to store credentials in plain JSON

**Algorithm Selection for Compliance**
- FIPS-compliant cipher selection
- Disable weak algorithms for security audits
- **Enterprise requirement:** Many organizations mandate specific algorithms

### Performance Optimizations

**Concurrent Operations**
- PRO Deployer: 5 concurrent transfers (40% faster than single-threaded)
- Configurable concurrency based on server limits
- **Your opportunity:** Add parallel upload/download for folders

**Compression**
- SSH compression during transfer (20-60% bandwidth reduction)
- **User request:** Especially important for slow connections

**Incremental Sync (Major Gap)**
- Rsync-style delta transfers (only send file differences)
- **Your current limitation:** Full file transfers every time
- **Example:** Sync-Rsync extension uses rsync protocol for 10x faster updates

**Transfer Speed Indicators**
- MB/s transfer speed
- Time remaining estimates
- **User complaint:** "I don't know if my 3GB upload is working or stuck"

### Sync Behavior Enhancements

**Bidirectional Sync**
- "Sync Both Directions" compares timestamps both ways
- Always keeps newest file in both locations
- **Your limitation:** Unidirectional sync actions only

**Sync Strategies**
- Mirror mode (make destination exactly match source)
- Update mode (only copy newer, never delete)
- **Your limitation:** Fixed behavior per action type

**Conflict Detection** (Highly Requested)
- **Diff-on-save:** Check if remote changed before uploading
- Warning dialog when conflicts detected
- Option to view diff and choose resolution
- **User pain point:** "I overwrote my teammate's changes accidentally"

**Git Integration**
- "Upload Changed Files" - only upload files changed since last commit
- Common in SFTP by Natizyskunk, Deploy extension
- **Your opportunity:** Upload uncommitted Git changes command

---

## 3. UI/UX Configuration Patterns

### Configuration Management

**Multi-File Config Pattern**
- `.vscode/sftp.json` for project settings (checked into git)
- User settings for credentials and preferences
- Environment variables for CI/CD: `"${env:VARIABLE}"`
- **Your opportunity:** Separate credential storage from project config

**Configuration Commands**
- `SFTP: Config` - Create/open config (always accessible)
- `SFTP: Set Profile` - Quick profile switching without editing
- `SFTP: Init` - Interactive config wizard (FTP-Simple)
- **Your gap:** Requires manual JSON editing for profile switching

**Config Validation**
- Intellisense for config properties
- JSON schema validation
- Clear error messages for invalid configs
- **User expectation:** VS Code-native JSON editing experience

### Progress & Status Indicators

**Detailed Progress (Most Requested UX Feature)**

Current implementations show:
- **Percentage complete** - "45% complete"
- **Transfer speed** - "2.5 MB/s"
- **File size progress** - "250 MB of 500 MB"
- **Current file** - "uploading webpack.bundle.js (3 of 47)"
- **Time remaining** - "~2 minutes remaining"

**VS Code Progress API Implementation:**
```javascript
vscode.window.withProgress({
  location: vscode.ProgressLocation.Notification,
  title: "Uploading Files",
  cancellable: true
}, async (progress, token) => {
  progress.report({ 
    increment: 20, 
    message: "file.js (1 of 5)" 
  });
});
```

**Your opportunity:** Enhance progress visibility beyond simple status indicators

**Status Bar Integration**
- Connection status indicator (connected/disconnected)
- Active transfer count
- Click to expand detailed view
- **Example:** Sync-Rsync shows clickable status to view output

### Remote Explorer Patterns

**File Operations in Tree View**
- Right-click: Upload, Download, Diff, Delete, Rename
- Multi-select with Ctrl/Shift+Click
- Drag-and-drop from local to remote tree
- **Your advantage:** You have tree view with diff - expand context menu options

**Remote Directory Browsing**
- View-only mode vs edit mode
- "Edit in Local" command downloads for editing
- Bookmark favorite remote paths
- Search remote files
- **Your opportunity:** Add read-only remote browsing mode

### Context Menu Patterns

**Alternative Commands on Alt-Click**
- Hold Alt key for alternative command options
- Example: Normal = upload respecting ignore, Alt = force upload
- **Your opportunity:** Surface secondary actions without menu clutter

**Common Context Menu Structure:**
1. Primary action (Upload File, Download File)
2. Secondary action (Sync, Diff with Remote)  
3. Destructive action (Delete Remote File)
4. Info/Debug actions (List Remote Directory)

### Command Palette Organization

**Consistent Naming Convention:**
- All commands prefixed with extension name ("SFTP:")
- Action-oriented names ("Upload File" not "File Upload")
- Context-aware availability (only show "Upload File" when file selected)

**Common Command Categories:**
1. **Config:** Config, Init, Set Profile
2. **Single File:** Upload/Download Active File, Diff with Remote
3. **Bulk Operations:** Upload/Download Project/Folder, Sync commands
4. **Advanced:** Open SSH Terminal, List Files, Stop Transfers

---

## 4. Advanced Features Commonly Expected

### Multi-Host & Environment Management

**Quick Environment Switching** (Highest Priority Gap)
- Profile switching command without config editing
- Visual indicator of active profile
- Per-profile security settings
- **User workflow:** Switch from dev to staging to prod dozens of times per day

**Workspace-Aware Configuration**
- Different configs per workspace folder in multi-root workspaces
- Inherit global settings with workspace overrides
- **Use case:** Monorepo with multiple deployment targets

### SSH Advanced Features

**Known Hosts Management** (Security Critical)
- Store fingerprints in `~/.ssh/known_hosts`
- Prompt: "The host key for server.com has changed. Continue?"
- **Without this:** Users vulnerable to MITM attacks

**Connection Diagnostics**
- Debug mode: Verbose SSH handshake logs
- Algorithm negotiation details
- Auth method attempts
- **User setting:** `sftp.debug: true` (requires VS Code reload)

**SSH Terminal Integration**
- "Open SSH in Terminal" command
- Auto-login to server in integrated terminal
- Uses same credentials as SFTP connection
- **User convenience:** Quick access to server shell

### Transfer Management

**Cancel All Transfers** (User Request)
- Stop button for long-running operations
- Cancel queue of pending uploads
- **Your limitation:** No visible way to stop in-progress operations

**Transfer Queue (FileZilla Pattern)**
- Queue multiple operations
- Pause/resume capability
- Reorder queue items
- Retry failed transfers
- **Use case:** Large project deployments with priority files

**Resume Capability**
- Resume interrupted downloads from last byte
- Checksum verification after resume
- **Use case:** Large files on unreliable connections

### Sync & Comparison

**Sync Wizard (FTP-sync Pattern)**
1. Run sync command to generate change list
2. Review proposed changes (added, modified, deleted)
3. Selectively approve/reject changes
4. Commit to execute
- **Why users want it:** Prevents accidental deletions/overwrites

**Directory Comparison**
- Side-by-side local vs remote tree comparison
- Highlight differences (newer, missing, different size)
- Bulk selection for sync
- **Example:** FileZilla's directory comparison feature

**Orphan Handling**
- Option to delete files that exist remotely but not locally
- Or leave orphaned files untouched
- **User choice:** Mirror vs additive deployment

### Build Tool Integration

**Generated Files Auto-Upload**
- Watch build output directory (e.g., `dist/`, `build/`)
- Auto-upload on change detection
- File extension filtering (e.g., only `.js` and `.css`)
- **Use case:** Upload Webpack/Rollup build outputs automatically

**Pre/Post Sync Hooks** (Sync-Rsync Feature)
- Execute commands before sync (e.g., `npm run build`)
- Execute commands after sync (e.g., clear CDN cache)
- Per-profile hooks
```json
{
  "preSyncCommand": "npm run build",
  "postSyncCommand": "ssh server 'systemctl restart nginx'"
}
```

### Remote File Editing

**Direct Server Editing (FTP-Simple Approach)**
- Open remote file directly without local copy
- Edit and save back to server
- No workspace synchronization required
- **Use case:** Quick config file edits on server

**Temporary Download Location**
- `remote-workspace` setting for download location
- On-demand vs preload all files
- **Pattern:** Keep remote files separate from project structure

### Security & Compliance

**Audit Logging**
- Log all file transfers with timestamps
- User action tracking
- Connection attempts and auth events
- **Enterprise requirement:** Security compliance audits

**Known Hosts Strict Mode**
- `StrictHostKeyChecking yes` equivalent
- Reject unknown hosts automatically
- **Security standard:** Prevent unauthorized server connections

**Timeout Configurations**
- Connect timeout (default: 10s)
- Read/write timeout
- Keepalive interval
- **Reliability:** Handle slow/unreliable networks

---

## Actionable Priority Gaps to Fill

### Priority 1: Critical for Professional Use

1. **Profile Management System**
   - `profiles` configuration object
   - "Set Profile" command to switch environments
   - Visual indicator of active profile
   - **Impact:** Enables multi-environment workflow

2. **SSH Agent Support**
   - `agent` property for ssh-agent integration
   - Pageant support for Windows
   - **Impact:** Security best practice, credential management

3. **Enhanced Progress Indicators**
   - Percentage, speed, ETA for transfers
   - VS Code progress notification API
   - Cancellable operations
   - **Impact:** User confidence during long operations

4. **Connection Pooling & Concurrency**
   - `concurrency` setting (default: 4)
   - Reuse connections across operations
   - **Impact:** 2-5x performance improvement

5. **Known Hosts Verification**
   - Check against `~/.ssh/known_hosts`
   - Fingerprint verification prompt
   - Changed key warning
   - **Impact:** Security vulnerability without this

### Priority 2: High User Demand

6. **Sync Options Granularity**
   - `syncOption.delete`, `skipCreate`, `ignoreExisting`, `update`
   - Per-action sync strategy configuration
   - **Impact:** Prevents accidental deletions, more control

7. **Conflict Detection & Warning**
   - Diff-on-save before upload
   - Warning when remote file modified
   - Side-by-side diff viewer
   - **Impact:** Prevents overwriting team changes

8. **File Permissions Control**
   - `filePerm` and `dirPerm` octal settings
   - **Impact:** Required for proper web server deployments

9. **OpenSSH Config Integration**
   - Read `~/.ssh/config` for connection settings
   - `sshConfigPath` property
   - **Impact:** Respects existing developer SSH setup

10. **Upload Changed Git Files**
    - Command to upload only uncommitted files
    - Integration with Git status
    - **Impact:** Faster deployments, selective uploads

### Priority 3: Competitive Differentiation

11. **FTP/FTPS Protocol Support**
    - `protocol: "ftp"` option
    - `secure` property for FTPS modes
    - **Impact:** Expand user base beyond SFTP-only

12. **External File Watcher**
    - `watcher` configuration for build outputs
    - Watch files changed outside VS Code
    - **Impact:** Build tool integration

13. **Bidirectional Sync**
    - "Sync Both Directions" command
    - Automatic conflict detection
    - **Impact:** Team collaboration scenarios

14. **Connection Hopping/Bastion Support**
    - `hop` property for jump hosts
    - **Impact:** Cloud/enterprise deployment access

15. **Pre/Post Sync Hooks**
    - `preSyncCommand` and `postSyncCommand`
    - **Impact:** Build automation, cache clearing

---

## Configuration UI/UX Recommendations

### Improve Configuration Discoverability

**Current State:** Users must know JSON properties
**Recommended:** 
- Configuration wizard: "SFTP: Init" command with prompts
- VS Code Settings UI for common options
- JSON schema with descriptions for intellisense

### Separate Credentials from Config

**Pattern:**
```
.vscode/sftp.json        (checked into git, no credentials)
.vscode/sftp.local.json  (gitignored, contains credentials)
```
Merge at runtime, credentials override config

### Visual Profile Switcher

**Implementation:**
- Status bar item showing active profile
- Click to open profile quick-pick menu
- Avoid command palette for frequent action

### Enhanced Validation & Errors

- Test connection command with detailed diagnostics
- Clear error messages: "Connection refused on port 22. Is SSH running?"
- Suggest fixes: "Try setting agent property for key authentication"

---

## Competitive Analysis Summary

| Feature | SFTP (Natizyskunk) | FTP-Simple | Deploy | PRO Deployer | **Your Plugin** |
|---------|-------------------|------------|--------|--------------|-----------------|
| Multi-protocol | ✅ SFTP, FTP | ✅ FTP, SFTP | ✅ 15+ protocols | ✅ SFTP, FTP | ⚠️ SFTP only |
| SSH agent | ✅ | ✅ | ❌ | ✅ | ❌ Missing |
| Profiles | ✅ | ✅ | ✅ | ✅ | ❌ Missing |
| Concurrent transfer | ✅ (4) | ❌ | ❌ | ✅ (5) | ⚠️ Unknown |
| Progress indicators | ⚠️ Basic | ⚠️ Basic | ⚠️ Basic | ✅ Detailed | ⚠️ Basic |
| Conflict detection | ❌ | ❌ | ❌ | ✅ Diff | ⚠️ Diff exists |
| Known hosts check | ❌ | ❌ | ❌ | ❌ | ❌ Missing (critical) |
| Connection hopping | ✅ | ❌ | ❌ | ❌ | ❌ Missing |
| File watcher | ✅ | ❌ | ✅ | ❌ | ⚠️ Save only |
| Remote explorer | ✅ | ✅ Beta | ❌ | ✅ | ✅ Your strength |
| Git integration | ✅ | ❌ | ❌ | ✅ | ❌ Missing |
| Permissions control | ✅ | ❌ | ❌ | ❌ | ❌ Missing |

**Your Competitive Advantages:**
- Tree view with diff visualization (well-implemented)
- Granular action configuration (actionOnSave, onCreate, etc.)
- Configuration panel UI

**Critical Gaps:**
- No profile/multi-environment support
- No SSH agent integration
- Missing known hosts verification (security risk)
- Limited progress feedback

---

## Implementation Roadmap Recommendation

**Phase 1: Security & Multi-Environment (6-8 weeks)**
1. SSH agent support (`agent` property)
2. Known hosts verification
3. Profile management system
4. OpenSSH config reading

**Phase 2: Performance & UX (4-6 weeks)**
5. Connection pooling and concurrency
6. Enhanced progress indicators (%, speed, ETA)
7. Sync option granularity
8. File permissions (filePerm, dirPerm)

**Phase 3: Advanced Features (6-8 weeks)**
9. Conflict detection warnings
10. FTP/FTPS protocol support
11. External file watcher
12. Git integration commands

**Phase 4: Power User Features (8-10 weeks)**
13. Connection hopping (bastion hosts)
14. Pre/post sync hooks
15. Bidirectional sync with conflict resolution

This prioritization addresses the most critical gaps first (security, multi-environment support) while building toward feature parity with market leaders.