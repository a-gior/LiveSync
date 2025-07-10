import { workspace, ExtensionContext, WorkspaceFolder, Uri, window, Event, EventEmitter, FileSystemWatcher } from "vscode";
import * as path from 'path';
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";
import { WorkspaceConfigFile } from "@shared/DTOs/config/WorkspaceConfig";
import { CONFIG_FILE_NAME, DEFAULT_WORKSPACE_CONFIG } from "../utilities/constants";
import { ConnectionSettings } from "../DTOs/config/ConnectionSettings";
import { FileEventActions } from "../DTOs/config/FileEventActions";
import { Minimatch } from "minimatch";

export enum WorkspaceType {
    SingleRoot,
    MultiRoot,
}

export function getConfigPath(folder: WorkspaceFolder): Uri {
    return Uri.joinPath(folder.uri, '.vscode', CONFIG_FILE_NAME);
}

export class WorkspaceConfigManager2 {

    private _context: ExtensionContext;
    private _workspaceType: WorkspaceType | null = null;
    private _workspaceConfigs: Map<Uri, WorkspaceConfig> = new Map();
    private _events: WorkspaceEventsManager;

    constructor(context: ExtensionContext) {
        this._context = context;
        this.detectWorkspaceType();

        // instantiate and subscribe to all workspace events here
        this._events = new WorkspaceEventsManager();
        this._context.subscriptions.push(this._events);

        this._events.onFolderAdded(async folder => {
            await this.loadConfig(folder);
        });
        this._events.onFolderRemoved(folder => {
            this.removeConfig(folder.uri);
        });
        this._events.onConfigCreated(async uri => {
            await this.loadConfigByUri(uri);
        });
        this._events.onConfigChanged(async uri => {
            await this.loadConfigByUri(uri);
        });
        this._events.onConfigDeleted(uri => {
            this.removeConfigForUri(uri);
        });

    }

    /**
     * Reads and registers a config for exactly one folder.
     */
    public async loadConfig(folder: WorkspaceFolder): Promise<void> {
        const configUri = getConfigPath(folder);
        try {
            await workspace.fs.stat(configUri);
        } catch {
            // no config file here
            return;
        }

        try {
            const instance = await WorkspaceConfig.create(folder);
            if (!instance.isValid) {
                logErrorMessage(`Invalid SFTP config for ${folder.name}`);
                return;
            }
            this._workspaceConfigs.set(folder.uri, instance);
            logInfoMessage(`Loaded config for ${folder.name}`);
        } catch (err: any) {
            logErrorMessage(`Failed to load config for ${folder.name}: ${err.message || err}`);
        }
    }

    /**
     * Given a Uri to a config JSON, find its workspace folder and load it.
     */
    public async loadConfigByUri(uri: Uri): Promise<void> {
        const folder      = workspace.getWorkspaceFolder(uri);
        if (!folder) {
            logErrorMessage(`No workspace folder found for config at ${uri.fsPath}`);
            return;
        }
        await this.loadConfig(folder);
    }

    /** Remove a folder’s config by its URI string key */
    public removeConfig(uri: Uri): void {
        this._workspaceConfigs.delete(uri);
        logInfoMessage(`Removed config for folder ${uri.fsPath}`);
    }

    /**
     * Remove a config based on the config-file Uri.
     * Derives the folder, then drops its entry.
     */
    public removeConfigForUri(uri: Uri): void {
        const folder      = workspace.getWorkspaceFolder(uri);
        if (!folder) {
           logErrorMessage(`No workspace folder found for ${uri.fsPath}`);
           return;
        }
        this.removeConfig(folder.uri);
    }

    detectWorkspaceType() {
        const folders: readonly WorkspaceFolder[] | undefined = workspace.workspaceFolders;
        const wsFile: Uri | undefined = workspace.workspaceFile;

        if (!folders) {
           throw new Error("No workspace is open at all.");
        }

        // 1. Single-folder (just one folder, no .code-workspace file)
        if (folders.length === 1 && !wsFile) {
            this._workspaceType = WorkspaceType.SingleRoot;
            logInfoMessage(`Single-folder workspace: ${folders[0].uri.fsPath}`);
            return;
        }

        // 2. Multi-root untitled (you added folders at runtime, VS Code created an in-memory “Untitled” workspace)
        if (wsFile?.scheme === 'untitled') {
            this._workspaceType = WorkspaceType.MultiRoot;
            logInfoMessage(`Untitled multi-root workspace with ${folders.length} folders`);
            return;
        }

        // 3. Multi-root saved (you opened a .code-workspace file from disk)
        if (wsFile?.scheme === 'file' && wsFile.fsPath.endsWith('.code-workspace')) {
            this._workspaceType = WorkspaceType.MultiRoot;
            logInfoMessage(`Saved multi-root workspace (${wsFile.fsPath}) with ${folders.length} folders`);
            return;
        }

        // 4. Edge—unlikely, but covers any other scenario
        throw new Error(`Workspace with ${folders.length} folders; file: ${wsFile?.toString()}`);
    }

    /**
     * Scan for `.vscode/custom-config.json` in the appropriate folders,
     * parse any you find, and create a WorkspaceConfig for each.
     */
    public async loadConfigs(): Promise<void> {
        const folders = workspace.workspaceFolders || [];
        for (const folder of folders) {
            const configPath = getConfigPath(folder);
            try {
                await workspace.fs.stat(configPath);
            } catch {
                logInfoMessage(`No config at ${folder.name}`);
                continue; // no config here
            }

            const instance = await WorkspaceConfig.create(folder);
            if (!instance.isValid) {
                throw new Error(`Invalid SFTP config for ${instance.rootName}`);
            } else {
                this._workspaceConfigs.set(folder.uri, instance);
            }
        }
    }

    /**
     * Update the on-disk config for the given folder, then reload
     * the in-memory WorkspaceConfig instance.
     *
     * @param folderName  the .name of the WorkspaceFolder to update
     * @param updates     the partial config to merge in
     */
    public async updateConfigForFolder(
        folderUri: Uri,
        updates: Partial<WorkspaceConfigFile>
    ): Promise<void> {
        const cfg = this.getConfig(folderUri);
        await cfg.updateParams(updates);

        this._workspaceConfigs.set(folderUri, cfg);
    }

    public getConfig(folderUri: Uri): WorkspaceConfig {
        const config = this._workspaceConfigs.get(folderUri);
        if (!config) {
            throw new Error(`No config found for workspace "${folderUri.fsPath}"`);
        }
        return config;
    }

    /** Pick a folder for multi-root, or return single root */
     async pickTargetFolder(): Promise<WorkspaceFolder> {
        const workspaceFolders = workspace.workspaceFolders;

        if (this._workspaceType === WorkspaceType.SingleRoot && workspaceFolders?.length === 1) {
            return workspaceFolders[0];
        }
        const pickedFolder = await window.showWorkspaceFolderPick({
            placeHolder: `Select the folder to place your ${CONFIG_FILE_NAME} in`,
        });

        if (!pickedFolder) {
            throw new Error('Folder selection cancelled');
        }

        return pickedFolder;
    }

    static getFolders(): readonly WorkspaceFolder[] {
        return workspace.workspaceFolders ?? [];
    }

    async openJsonConfig(folder: WorkspaceFolder): Promise<void> {
        const configUri = getConfigPath(folder);

        // Ensure the file exists
        try {
            await workspace.fs.stat(configUri);
        } catch {
            // File doesn’t exist yet → create it with defaults
            const content = Buffer.from(
                JSON.stringify(DEFAULT_WORKSPACE_CONFIG, null, 2),
                'utf8'
            );
            try {
                await workspace.fs.writeFile(configUri, content);
                logInfoMessage(
                    `Created default LiveSync config for "${folder.name}".`
                );
            } catch (err: any) {
                logErrorMessage(
                    `Failed to create config file: ${err.message}`
                );
            return;
            }
        }

        // Open it in the text editor
        try {
            const doc = await workspace.openTextDocument(configUri);
            await window.showTextDocument(doc, { preview: false });
        } catch (err: any) {
            window.showErrorMessage(
                `Could not open config file: ${err.message || err}`
            );
        }
    }
}

export class WorkspaceConfig {
    private readonly _folder: WorkspaceFolder;
    private _workspaceConfig: WorkspaceConfigFile;
    private _compiledIgnoreMatchers: Minimatch[] | null = null;

    private constructor(folder: WorkspaceFolder, config: WorkspaceConfigFile) {
        this._folder = folder;
        this._workspaceConfig = config;
    }

    /** The folder’s human-readable name */
    public get rootName(): string {
        return this._folder.name;
    }

    /** The raw configuration block (hostname/port/username/etc) */
    public get connectionSettings(): ConnectionSettings | undefined {
        const {
        hostname,
        port,
        username,
        password,
        privateKeyPath,
        passphrase,
        } = this._workspaceConfig;

        return { hostname, port, username, password, privateKeyPath, passphrase };
    }

    /** The remotePath value */
    public get remotePath(): WorkspaceConfigFile["remotePath"] {
        return this._workspaceConfig.remotePath;
    }

    /** File-event actions */
    public get fileEventActions(): FileEventActions {
        const {
            actionOnUpload,
            actionOnDownload,
            actionOnSave,
            actionOnCreate,
            actionOnDelete,
            actionOnMove,
            actionOnOpen,
        } = this._workspaceConfig;

        return {actionOnUpload, actionOnDownload, actionOnSave, actionOnCreate, actionOnDelete, actionOnMove, actionOnOpen};
    }

    /** The ignore-list of globs/paths */
    public get ignoreList(): Minimatch[] {
        if(!this._compiledIgnoreMatchers) {
            
            if (!this._workspaceConfig.ignoreList) {
                throw new Error("Ignore List not configured");
            }

            const raw = this._workspaceConfig.ignoreList;
            const expandedGlobs = raw.flatMap((pattern) =>
                pattern.includes("/") || pattern.includes("*")
                ? [pattern]
                : [pattern, `**/${pattern}/**`]
            );

            // we use the Minimatch class directly for typing
            this._compiledIgnoreMatchers = expandedGlobs.map(
                (glob) => new Minimatch(glob, { dot: true, matchBase: true })
            );
        }

        return this._compiledIgnoreMatchers;
    }

    public async addToIgnoreList(...paths: string[]): Promise<void> {
        try {
            const current: string[] = Array.isArray(this._workspaceConfig.ignoreList) ? this._workspaceConfig.ignoreList : [];

            // Filter out any that are already present
            const uniqueNew = paths.filter(p => !current.includes(p));
            if (uniqueNew.length === 0) {
                logErrorMessage(
                `No new paths to add to ignore list.`,
                LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
                );
                return;
            }

            // Append & persist via your existing update method
            const updatedList = [...current, ...uniqueNew];
            await this.updateParams({ ignoreList: updatedList });

            logInfoMessage(
                `Added to ignore list:\n  • ${uniqueNew.join('\n  • ')}`,
                LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
            );
        } catch (err: any) {
            logErrorMessage(
                `Error adding to ignore list: ${paths.join(', ')}`,
                LOG_FLAGS.ALL,
                err
            );
        }
    }

    /**
     * Merge the given updates into the on-disk JSON,
     * then reload the in-memory config.
     */
    public async updateParams(
    updates: Partial<WorkspaceConfigFile>
    ): Promise<void> {
        const configUri = getConfigPath(this._folder);

        const raw = await workspace.fs.readFile(configUri);
        const existing = JSON.parse(raw.toString()) as WorkspaceConfigFile;

        const merged: WorkspaceConfigFile = {
            ...existing,
            ...updates
        };

        await workspace.fs.writeFile(
            configUri,
            Buffer.from(JSON.stringify(merged, null, 2), 'utf8')
        );

        await this.reload();
    }

    /** Reload from disk into the private `_workspaceConfig` field */
    public async reload(): Promise<void> {
        const configUri: Uri = getConfigPath(this._folder);
        const raw = await workspace.fs.readFile(configUri);
        this._workspaceConfig = JSON.parse(raw.toString());
    }

    /**
     * Async factory method: reads & parses the config, 
     * then returns a fully-initialized instance.
     */
    public static async create(folder: WorkspaceFolder): Promise<WorkspaceConfig> {
        const configFile = getConfigPath(folder);
        let raw: Uint8Array;
        try {
            raw = await workspace.fs.readFile(configFile);
        } catch (err: any) {
            throw new Error(`Could not read config at ${configFile.fsPath}: ${err.message}`);
        }

        let parsed: WorkspaceConfigFile;
        try {
            parsed = JSON.parse(raw.toString());
        } catch (err: any) {
            throw new Error(`Invalid JSON in ${configFile.fsPath}: ${err.message}`);
        }

        
        // Merge user-provided values onto defaults
        const fullConfig: WorkspaceConfigFile = {
            ...DEFAULT_WORKSPACE_CONFIG,
            ...parsed
        };

        return new WorkspaceConfig(folder, fullConfig);
    }

    /**
     * Validate that the loaded workspace-config has all required connection
     * settings and at least one auth method (password or privateKeyPath).
     */
    public get isValid(): boolean {
        const cfg = this._workspaceConfig;
        const isSet = (s?: string) => !!(s && s.trim());

        if (!cfg || !isSet(cfg.hostname) || !isSet(cfg.username)) return false;
        if (!isSet(cfg.password) && !isSet(cfg.privateKeyPath)) return false;
        if (!isSet(cfg.remotePath)) return false;
        return true;
    }

    /**
     * Returns the local filesystem path of this workspace root
     * and its configured remotePath (if any).
     */
    public getPaths(): { localPath: string; remotePath: string } {

        const localPath = this._folder.uri.fsPath;
        const remotePath = this._workspaceConfig.remotePath;
        if(!remotePath) {
            throw new Error(`Workspace "${this._folder.name}" has no remotePath configured.`);
        }

        return { localPath, remotePath };
    }
}

export class WorkspaceEventsManager {
    private readonly _onFolderAdded = new EventEmitter<WorkspaceFolder>();
    public readonly onFolderAdded: Event<WorkspaceFolder> = this._onFolderAdded.event;

    private readonly _onFolderRemoved = new EventEmitter<WorkspaceFolder>();
    public readonly onFolderRemoved: Event<WorkspaceFolder> = this._onFolderRemoved.event;

    private readonly _onConfigCreated = new EventEmitter<Uri>();
    public readonly onConfigCreated: Event<Uri> = this._onConfigCreated.event;

    private readonly _onConfigChanged = new EventEmitter<Uri>();
    public readonly onConfigChanged: Event<Uri> = this._onConfigChanged.event;

    private readonly _onConfigDeleted = new EventEmitter<Uri>();
    public readonly onConfigDeleted: Event<Uri> = this._onConfigDeleted.event;

    private watcher: FileSystemWatcher;

    constructor() {
        // Watch for workspace folder adds/removals
        workspace.onDidChangeWorkspaceFolders(evt => {
            evt.added.forEach(folder => this._onFolderAdded.fire(folder));
            evt.removed.forEach(folder => this._onFolderRemoved.fire(folder));
        });

        // Watch for config file create/change/delete in any .vscode folder
        this.watcher = workspace.createFileSystemWatcher(`**/.vscode/${CONFIG_FILE_NAME}`);
        this.watcher.onDidCreate(uri => this._onConfigCreated.fire(uri));
        this.watcher.onDidChange(uri => this._onConfigChanged.fire(uri));
        this.watcher.onDidDelete(uri => this._onConfigDeleted.fire(uri));
    }

    public dispose() {
        this.watcher.dispose();
        this._onFolderAdded.dispose();
        this._onFolderRemoved.dispose();
        this._onConfigCreated.dispose();
        this._onConfigChanged.dispose();
        this._onConfigDeleted.dispose();
    }
}