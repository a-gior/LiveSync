import { ConfigurationMessage } from "../messages/ConfigurationMessage";
import { FileEventActionsMessage } from "../messages/FileEventActionsMessage";
import { PairFoldersMessage } from "../messages/PairFoldersMessage";

export interface ConfigurationState {
  configuration?: ConfigurationMessage["configuration"];
  pairedFolders?: PairFoldersMessage["paths"][];
  fileEventActions?: FileEventActionsMessage["actions"];
}
