import { EventEmitter, FileSystemWatcher, Uri, workspace, WorkspaceFolder } from "vscode";
import { CONFIG_FILE_NAME } from "../utilities/constants";


export class WorkspaceEventsManager implements Disposable {
    private readonly _onFolderAdded = new EventEmitter<WorkspaceFolder>();
    public readonly onFolderAdded = this._onFolderAdded.event;

    private readonly _onFolderRemoved = new EventEmitter<WorkspaceFolder>();
    public readonly onFolderRemoved = this._onFolderRemoved.event;

    private readonly _onConfigCreated = new EventEmitter<Uri>();
    public readonly onConfigCreated = this._onConfigCreated.event;

    private readonly _onConfigChanged = new EventEmitter<Uri>();
    public readonly onConfigChanged = this._onConfigChanged.event;

    private readonly _onConfigDeleted = new EventEmitter<Uri>();
    public readonly onConfigDeleted = this._onConfigDeleted.event;

    private watcherChange: FileSystemWatcher;
    private watcherCreate: FileSystemWatcher;
    private watcherDelete: FileSystemWatcher;

    // remember recent events to squash dupes (multi-root overlap + Windows double-fire)
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly dedupeWindowMs = 200; // tweak if needed

    constructor() {
        workspace.onDidChangeWorkspaceFolders(evt => {
            evt.added.forEach(f => this._onFolderAdded.fire(f));
            evt.removed.forEach(f => this._onFolderRemoved.fire(f));
        });

        const glob = `**/.vscode/${CONFIG_FILE_NAME}`;

        // Separate watchers so each event has a single source
        this.watcherChange = workspace.createFileSystemWatcher(
            glob,
            /* ignoreCreate */ true,
            /* ignoreChange */ false,
            /* ignoreDelete */ true
        );
        this.watcherCreate = workspace.createFileSystemWatcher(
            glob,
            /* ignoreCreate */ false,
            /* ignoreChange */ true,
            /* ignoreDelete */ true
        );
        this.watcherDelete = workspace.createFileSystemWatcher(
            glob,
            /* ignoreCreate */ true,
            /* ignoreChange */ true,
            /* ignoreDelete */ false
        );

        this.watcherCreate.onDidCreate((uri: Uri) => this.fireOnce('create', uri, this._onConfigCreated));
        this.watcherChange.onDidChange((uri: Uri) => this.fireOnce('change', uri, this._onConfigChanged));
        this.watcherDelete.onDidDelete((uri: Uri) => this.fireOnce('delete', uri, this._onConfigDeleted));
    }

    [Symbol.dispose](): void {
        throw new Error("Method not implemented.");
    }

    private fireOnce(
        kind: 'create' | 'change' | 'delete',
        uri: Uri,
        emitter: EventEmitter<Uri>
    ): void {
        const key = `${kind}|${uri.toString().toLowerCase()}`;

        // reset existing timer for this key
        const prev = this.debounceTimers.get(key);
        if (prev) {clearTimeout(prev);}

        // schedule a new trailing call
        const timer = setTimeout(() => {
            this.debounceTimers.delete(key);     // cleanup first
            emitter.fire(uri);                   // fire the last event seen
        }, this.dedupeWindowMs);

        this.debounceTimers.set(key, timer);
    }

    dispose(): void {
        this.watcherChange.dispose();
        this.watcherCreate.dispose();
        this.watcherDelete.dispose();
        this._onFolderAdded.dispose();
        this._onFolderRemoved.dispose();
        this._onConfigCreated.dispose();
        this._onConfigChanged.dispose();
        this._onConfigDeleted.dispose();
    }
}