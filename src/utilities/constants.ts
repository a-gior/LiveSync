import * as path from "path";

export const ROOT_FOLDER_NAME = "%%ROOT%%";

export const SAVE_DIR = path.join(__dirname, "..", "saved_data");

export const LOCAL_FILES_JSON = "localFiles.json";
export const REMOTE_FILES_JSON = "remoteFiles.json";
export const COMPARE_FILES_JSON = "compareFiles.json";

export const LOCAL_FILES_PATH = path.join(SAVE_DIR, LOCAL_FILES_JSON);
export const REMOTE_FILES_PATH = path.join(SAVE_DIR, REMOTE_FILES_JSON);
export const COMPARE_FILES_PATH = path.join(SAVE_DIR, COMPARE_FILES_JSON);

export const MEDIA_DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "resources",
  "media",
);

export const ICON_MAPPINGS_JSON = "icons_mapping.json";
export const ICON_MAPPINGS_PATH = path.join(MEDIA_DIR, ICON_MAPPINGS_JSON);

export const FOLDER_ICON_MAPPINGS_JSON = "folders_icons_mapping.json";
export const FOLDER_ICON_MAPPINGS_PATH = path.join(
  MEDIA_DIR,
  FOLDER_ICON_MAPPINGS_JSON,
);

export const LANGUAGEIDS_ICON_MAPPINGS_JSON = "languageIds_mapping.json";
export const LANGUAGEIDS_ICON_MAPPINGS_PATH = path.join(
  MEDIA_DIR,
  LANGUAGEIDS_ICON_MAPPINGS_JSON,
);

export const FILE_ICONS_ZIP_PATH = path.join(MEDIA_DIR, "VSCodeIcons.zip");
export const FOLDER_ICONS_ZIP_PATH = path.join(
  MEDIA_DIR,
  "VSCodeIcons_Folders.zip",
);

export const DEFAULT_FOLDER_ICON = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "resources",
  "media",
  "dark",
  "folder_opened.svg",
);
export const DEFAULT_FILE_ICON_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "resources",
  "media",
  "dark",
  "file_custom.svg",
);
