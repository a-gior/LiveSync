export interface WorkspaceConfigData {
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  remotePath?: string;

  actionOnUpload?: string;   // keep raw strings you already use
  actionOnDownload?: string;
  actionOnSave?: string;
  actionOnCreate?: string;
  actionOnDelete?: string;
  actionOnMove?: string;
  actionOnOpen?: string;

  ignoreList?: string[];     // e.g., [".vscode", ".svn"]
}

export interface EffectiveWorkspaceConfig {
  data: WorkspaceConfigData;
  // convenience precomputations
  ignoreGlobs: string[];     // resolved from ignoreList into VSCode glob patterns
  hasRemote: boolean;        // hostname && remotePath present
}
