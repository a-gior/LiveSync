import { ConfigurationMessage } from "./ConfigurationMessage";
import { Message } from "./Message";
import { PairFoldersMessage } from "./PairFoldersMessage";

export interface FullConfigurationMessage extends Message {
  command: string;
  configuration?: ConfigurationMessage["configuration"];
  pairedFolders?: PairFoldersMessage["paths"][];
}
