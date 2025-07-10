import { WorkspaceFolder } from "vscode";
import { ConnectionSettings } from "../config/ConnectionSettings";
import { FileEventActions } from "../config/FileEventActions";
import { WorkspaceConfigFile } from "../config/WorkspaceConfig";
import { Message } from "./Message";

// DTO that represents a message that contains the full configuration of a connection.
export interface FullConfigurationMessage extends Message {
  command: string;
  workspaceFolders?: readonly WorkspaceFolder[];
  selectedFolder?: WorkspaceFolder;
  configuration?: ConnectionSettings;
  remotePath?: WorkspaceConfigFile["remotePath"];
  fileEventActions?: FileEventActions;
  ignoreList?: WorkspaceConfigFile["ignoreList"];
}
