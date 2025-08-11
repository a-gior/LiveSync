import { workspace, ExtensionContext, WorkspaceFolder, Uri, window, Event, EventEmitter, FileSystemWatcher, commands } from "vscode";
import * as path from 'path';
import { LOG_FLAGS, logConfigError, logErrorMessage, logInfoMessage } from "./LogManager";
import { WorkspaceConfigFile } from "@shared/DTOs/config/WorkspaceConfig";
import { CONFIG_FILE_NAME, DEFAULT_WORKSPACE_CONFIG } from "../utilities/constants";
import { ConnectionSettings } from "../DTOs/config/ConnectionSettings";
import { FileEventActions } from "../DTOs/config/FileEventActions";
import { Minimatch } from "minimatch";
import { FileNodeSource } from "../utilities/FileNode";
import { normalizePath, PathPair } from "../utilities/fileUtils/filePathUtils";
import { WorkspaceJsonStore } from "../services/WorkspaceJsonStore";
import { ConnectionService } from "../services/ConnectionService";
import { StatusBarManager } from "./StatusBarManager";

export enum WorkspaceType {
    SingleRoot,
    MultiRoot,
}

export function getConfigPath(folder: WorkspaceFolder): Uri {
    return Uri.joinPath(folder.uri, '.vscode', CONFIG_FILE_NAME);
}

export function updateMultiRootContext() {
  const folders = workspace.workspaceFolders || [];
  const isMulti = folders.length > 1;
  commands.executeCommand('setContext', 'livesync.multiRoot', isMulti);
}

export class WorkspaceConfigManager {

    private _context: ExtensionContext;
    private _workspaceType: WorkspaceType | null = null;
    private _workspaceConfigs: Map<string, WorkspaceConfig> = new Map();
    private _pathsByHost     = new Map<string, Set<string>>();
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

    private set workspaceType(type: WorkspaceType) {
        this._workspaceType = type;
        commands.executeCommand('setContext', 'livesync.multiRoot', type === WorkspaceType.MultiRoot );
    }

    public get workspaceConfigs(): Map<string, WorkspaceConfig> {
        return this._workspaceConfigs;
    }

    private async processFolder(folder: WorkspaceFolder): Promise<void> {
        this.detectWorkspaceType();

        const configUri = getConfigPath(folder);
        try {
            await workspace.fs.stat(configUri);
        } catch {
            StatusBarManager.markErrored(folder.uri.fsPath.toString(), 'No config found');
            return;
        }

        // As long as the config exists, we create and register it
        let instance: WorkspaceConfig;
        try {
            instance = await WorkspaceConfig.create(this, folder);
        } catch (err: any) {
            logErrorMessage(`Failed to read/parse config for ${folder.name}: ${err.message || err}`);
            return;
        }
        this.registerConfig(folder, instance);

        if (!instance.isValid) {
            console.warn(`Invalid config for ${folder.name}:`, instance);
            StatusBarManager.markErrored(instance.id, 'Invalid Config');
            logConfigError(this._context, LOG_FLAGS.ALL, true, folder, `Invalid Config for ${folder.name}`);
            return;
        }

        try {
            await instance.connectionService.ensureReachable();
        } catch (err: any) {
            const errorMessage = String(err?.message ?? err);
            StatusBarManager.markErrored(instance.id, errorMessage);
            logErrorMessage(`${folder.name}: ${errorMessage}`, LOG_FLAGS.CONSOLE_AND_VSCODE);
        }
    }

    public async loadConfig(folder: WorkspaceFolder): Promise<void> {
        await this.processFolder(folder);
    }

    public async loadConfigs(): Promise<void> {
        for (const folder of workspace.workspaceFolders ?? []) {
            await this.loadConfig(folder);
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
    
    /**
     * Returns true if cfg was added, false if it conflicted and was skipped.
     * Logs a config‐error on conflict.
     */
    private registerConfig(folder: WorkspaceFolder, cfg: WorkspaceConfig) {
        const host = cfg.connectionSettings!.hostname;
        const rp   = cfg.remotePath!.trim();

        let set = this._pathsByHost.get(host);
        if (!set) {
            set = new Set<string>();
            this._pathsByHost.set(host, set);
        }

        for (const existing of set) {
            if (rp.startsWith(existing + '/')) {
                logConfigError(
                    this._context,
                    LOG_FLAGS.ALL,
                    false,
                    folder,
                    `Config for "${folder.name}" skipped: "${rp}" is inside existing path "${existing}".`
                );
                return;
            }
            if (existing.startsWith(rp + '/')) {
                logConfigError(
                    this._context,
                    LOG_FLAGS.ALL,
                    false,
                    folder,
                    `Config for "${folder.name}" skipped: existing path "${existing}" is inside "${rp}".`
                );
                return;
            }
        }

        // no conflicts → register
        set.add(rp);
        this._workspaceConfigs.set(folder.uri.fsPath, cfg);
        logInfoMessage(`Registered config for "URI: ${folder.uri}, ${folder.name}" → host=${host}, remotePath=${rp}`);
    }

    /** Remove a folder’s config by its URI string key */
    public removeConfig(uri: Uri): void {
        this.detectWorkspaceType();

        const cfg = this._workspaceConfigs.get(uri.fsPath);
        if(!cfg) {return;}

        const host = cfg.connectionSettings!.hostname;
        let rp   = cfg.remotePath!.trim();
        const set = this._pathsByHost.get(host);
        if (set) {
            set.delete(rp);
            // if no more paths for this host, drop the host entry altogether
            if (set.size === 0) {
            this._pathsByHost.delete(host);
            }
        }

        this._workspaceConfigs.delete(uri.fsPath);
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
            this.workspaceType = WorkspaceType.SingleRoot;
            logInfoMessage(`Single-folder workspace: ${folders[0].uri.fsPath}`);
            return;
        }

        // 2. Multi-root untitled (you added folders at runtime, VS Code created an in-memory “Untitled” workspace)
        if (wsFile?.scheme === 'untitled') {
            this.workspaceType = WorkspaceType.MultiRoot;
            logInfoMessage(`Untitled multi-root workspace with ${folders.length} folders`);
            return;
        }

        // 3. Multi-root saved (you opened a .code-workspace file from disk)
        if (wsFile?.scheme === 'file' && wsFile.fsPath.endsWith('.code-workspace')) {
            this.workspaceType = WorkspaceType.MultiRoot;
            logInfoMessage(`Saved multi-root workspace (${wsFile.fsPath}) with ${folders.length} folders`);
            return;
        }

        // 4. Edge—unlikely, but covers any other scenario
        throw new Error(`Workspace with ${folders.length} folders; file: ${wsFile?.toString()}`);
    }

    public getConfig(folderUri: Uri): WorkspaceConfig {
        const config = this._workspaceConfigs.get(folderUri.fsPath);
        if (!config) {
            throw new Error(`No config found for workspace "${path.basename(folderUri.fsPath)}"`);
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

    getFolders(): readonly WorkspaceFolder[] {
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

    getPathPairs(returnNormalizedPaths: boolean = true): PathPair[] {
        let pathPairs: PathPair[] = [];

        for(const workspaceConfig of this._workspaceConfigs.values()) {
            pathPairs.push(workspaceConfig.getPathPair(returnNormalizedPaths));
        }

        return pathPairs;
    }

    findCorrespondingPath(fullPath: string) {
    
        const normalizedPath = normalizePath(fullPath);
        const pathPairs = this.getPathPairs();

        for( const pathPair of pathPairs) {

            // If the inputPath is a local path
            if (normalizedPath.startsWith(normalizePath(pathPair.localPath))) {
                return path.posix.join(pathPair.remotePath, path.posix.relative(pathPair.localPath, normalizedPath));
            }

            // If the inputPath is a remote path
            if (normalizedPath.startsWith(normalizePath(pathPair.remotePath))) {
                return path.join(pathPair.localPath, path.relative(pathPair.remotePath, normalizedPath));
            }
        }

        throw new Error(`Couldnt find corresponding path of ${fullPath}`);
    }

    getWorkspaceFolderFromPath(fullPath: string, source: FileNodeSource): WorkspaceFolder {
        let localPath: string;
        if(source === FileNodeSource.local) {
            localPath = fullPath;
        } else {
            // remote path
            localPath = this.findCorrespondingPath(fullPath);
        }

        const fileUri = Uri.file(localPath);
        const workspaceFolder = workspace.getWorkspaceFolder(fileUri);
        if(!workspaceFolder) {
            throw new Error(`No workspace found for ${localPath}`);
        }
        return workspaceFolder;
    }
}

export class WorkspaceConfig {
    private readonly _folder: WorkspaceFolder;
    private _workspaceConfig: WorkspaceConfigFile;
    private _compiledIgnoreMatchers: Minimatch[] | null = null;
    public readonly jsonStore: WorkspaceJsonStore;
    public readonly connectionService: ConnectionService;

    private constructor(public readonly id: string, private readonly _configManager: WorkspaceConfigManager, folder: WorkspaceFolder, config: WorkspaceConfigFile, connectionService: ConnectionService) {
        this._folder = folder;
        this._workspaceConfig = config;

        this.jsonStore = new WorkspaceJsonStore(folder.uri);
        this.connectionService = connectionService;
    }

    public async initialize() {
        await this.jsonStore.loadAll();
    }

    public get folder(): WorkspaceFolder {
        return this._folder;
    }

    /** The folder’s  name */
    public get folderName(): string {
        return this._folder.name;
    }

    /** The raw configuration block (hostname/port/username/etc) */
    public get connectionSettings(): ConnectionSettings {
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
    public get ignoreList(): string[] {
        return this._workspaceConfig.ignoreList ?? [];
    }

    /** The compiled ignore-list of globs/paths */
    public get compiledIgnoreList(): Minimatch[] {
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
    public static async create(configManager: WorkspaceConfigManager, folder: WorkspaceFolder): Promise<WorkspaceConfig> {
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

        const connSvc = new ConnectionService(fullConfig);
        const workspaceConfig = new WorkspaceConfig(folder.uri.fsPath, configManager, folder, fullConfig, connSvc);
        await workspaceConfig.initialize();
        return workspaceConfig;
    }

    /**
     * Validate that the loaded workspace-config has all required connection
     * settings and at least one auth method (password or privateKeyPath).
     */
    public get isValid(): boolean {
        const cfg = this._workspaceConfig;
        const isSet = (s?: string) => !!(s && s.trim());

        if (!cfg || !isSet(cfg.hostname) || !isSet(cfg.username)) {return false;}
        if (!isSet(cfg.password) && !isSet(cfg.privateKeyPath)) {return false;}
        if (!isSet(cfg.remotePath)) {return false;}
        return true;
    }

    /**
     * Returns the local filesystem path of this workspace root
     * and its configured remotePath (if any).
     */
    public getPathPair(returnNormalizedPaths: boolean = true): PathPair {

        const localPath = this._folder.uri.fsPath;
        const remotePath = this._workspaceConfig.remotePath;
        if(!remotePath) {
            throw new Error(`Workspace "${this._folder.name}" has no remotePath configured.`);
        }

        if(returnNormalizedPaths) {
            return { localPath: normalizePath(localPath), remotePath: normalizePath(remotePath) };
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