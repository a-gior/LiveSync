import { ConfigurationMessage } from "./ConfigurationMessage";
import { FileEventActionsMessage } from "./FileEventActionsMessage";
import { Message } from "./Message";
import { PairFoldersMessage } from "./PairFoldersMessage";

export interface FullConfigurationMessage extends Message {
  command: string;
  configuration?: ConfigurationMessage["configuration"];
  pairedFolders?: PairFoldersMessage["paths"][];
  fileEventActions?: FileEventActionsMessage["actions"];
}
