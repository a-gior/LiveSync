import { ConnectionSettings } from './ConnectionSettings';
import { FileEventActions } from './FileEventActions';

export interface WorkspaceConfigFile extends ConnectionSettings, FileEventActions {

  /** Remote path root  */
  remotePath?: string;

  /** List of globs or paths to ignore */
  ignoreList?: string[];
}