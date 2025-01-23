import { ConfigurationMessage } from "./ConfigurationMessage";
import { FileEventActionsMessage } from "./FileEventActionsMessage";
import { IgnoreListMessage } from "./IgnoreListMessage";
import { Message } from "./Message";

export interface FullConfigurationMessage extends Message {
  command: string;
  configuration?: ConfigurationMessage["configuration"];
  remotePath?: string;
  fileEventActions?: FileEventActionsMessage["actions"];
  ignoreList?: IgnoreListMessage["ignoreList"];
}
