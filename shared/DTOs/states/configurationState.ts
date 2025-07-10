import { WorkspaceFolder } from "vscode";
import { ConnectionSettings } from "../config/ConnectionSettings";
import { FileEventActions } from "../config/FileEventActions";
import { WorkspaceConfigFile } from "../config/WorkspaceConfig";

export interface ConfigurationState {
  configuration?: ConnectionSettings;
  remotePath?: WorkspaceConfigFile["remotePath"];
  fileEventActions?: FileEventActions;
  ignoreList?: WorkspaceConfigFile["ignoreList"];
  workspaceFolders?: WorkspaceFolder[];
  selectedFolder?: WorkspaceFolder;
}
