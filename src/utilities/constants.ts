import * as path from "path";
import { WorkspaceConfigFile } from "@shared/DTOs/config/WorkspaceConfig";

export const CONFIG_FILE_NAME = "livesync.json";

export const RELATIVE_PATH_SEP = "/";
export const LINUX_PATH_SEP = "/";
export const WINDOWS_PATH_SEP = "\\";

export const SAVE_DIR = path.join(__dirname, "..", "saved_data");

export const REMOTE_FILES_JSON = "remoteFiles.json";
export const COMPARE_FILES_JSON = "compareFiles.json";
export const FOLDERS_STATE_JSON = "foldersState.json";

export const MEDIA_DIR = path.join(__dirname, "..", "..", "..", "resources", "media");

export const ICON_MAPPINGS_PATH = path.join(MEDIA_DIR, "icons_mapping.json");

export const DEFAULT_FOLDER_ICON = path.join(__dirname, "..", "..", "..", "resources", "media", "dark", "folder_opened.svg");
export const DEFAULT_FILE_ICON_PATH = path.join(__dirname, "..", "..", "..", "resources", "media", "dark", "file_custom.svg");

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfigFile = {
  // ConnectionSettings (required)
  hostname:      '',               
  port:          22,
  username:      '', 
  password:      '',   
  privateKeyPath:'', 
  passphrase:    '',  

  // Remote path root
  remotePath:    '',

  // FileEventActions (optional)
  actionOnUpload:   'check&upload',
  actionOnDownload: 'check&download',
  actionOnSave:     'check&save',  
  actionOnCreate:   'check&create', 
  actionOnDelete:   'none',    
  actionOnMove:     'check&move',  
  actionOnOpen:     'check&download', 

  // Ignore list
  ignoreList: ['.vscode'],
};