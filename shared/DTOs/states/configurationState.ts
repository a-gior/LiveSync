import { ConfigurationMessage } from "../messages/ConfigurationMessage";
import { PairFoldersMessage } from "../messages/PairFoldersMessage";

export interface ConfigurationState {
  configuration?: ConfigurationMessage["configuration"];
  pairedFolders?: PairFoldersMessage["paths"][];
}
