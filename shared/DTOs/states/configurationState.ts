import { ConfigurationMessage } from "../messages/ConfigurationMessage";
import { FileEventActionsMessage } from "../messages/FileEventActionsMessage";
import { IgnoreListMessage } from "../messages/IgnoreListMessage";
import { PairFoldersMessage } from "../messages/PairFoldersMessage";

export interface ConfigurationState {
  configuration?: ConfigurationMessage["configuration"];
  pairedFolders?: PairFoldersMessage["paths"][];
  fileEventActions?: FileEventActionsMessage["actions"];
  ignoreList?: IgnoreListMessage["ignoreList"];
}
