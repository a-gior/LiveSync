import { ConfigurationMessage } from "../messages/ConfigurationMessage";
import { FileEventActionsMessage } from "../messages/FileEventActionsMessage";
import { IgnoreListMessage } from "../messages/IgnoreListMessage";

export interface ConfigurationState {
  configuration?: ConfigurationMessage["configuration"];
  remotePath?: string;
  fileEventActions?: FileEventActionsMessage["actions"];
  ignoreList?: IgnoreListMessage["ignoreList"];
}
