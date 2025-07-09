import { WorkspaceConfigFile } from "../config/WorkspaceConfig";
import { Message } from "./Message";

// DTO that represents a message that contains a list of files that should be ignored.
export interface IgnoreListMessage extends Message {
  command: string;
  ignoreList: WorkspaceConfigFile["ignoreList"];
}
