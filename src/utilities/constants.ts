import * as path from "path";

export const SAVE_DIR = path.join(__dirname, "..", "saved_data");

export const LOCAL_FILES_JSON = "localFiles.json";
export const REMOTE_FILES_JSON = "remoteFiles.json";
export const COMPARE_FILES_JSON = "compareFiles.json";

export const LOCAL_FILES_PATH = path.join(SAVE_DIR, LOCAL_FILES_JSON);
export const REMOTE_FILES_PATH = path.join(SAVE_DIR, REMOTE_FILES_JSON);
export const COMPARE_FILES_PATH = path.join(SAVE_DIR, COMPARE_FILES_JSON);
