export enum Action {
  Add = "add",
  Remove = "remove",
  Update = "update",
  Move = "Move",
  Save = "Save",
  Open = "Open"
}

export enum Check {
  remoteExists = "remoteExists",
  remoteExistsDelete = "remoteExistsDelete",
  remoteNotSameOverwrite = "remoteNotSameOverwrite",
  remoteNotSameDownload = "remoteNotSameDownload",
  localExists = "localExists"
}

export enum ActionResult {
  NoAction = "NoAction", // No action was done
  DontExist = "DontExist", // Check file existence was false
  Exists = "Exists", // Check file existence was done and isSame is true
  IsNotSame = "IsNotSame", // Check was done and isSame was false
  ActionPerformed = "ActionPerformed" // Action has been done
}

export enum ActionOn {
  Upload = "actionOnUpload",
  Download = "actionOnDownload",
  Save = "actionOnSave",
  Create = "actionOnCreate",
  Delete = "actionOnDelete",
  Move = "actionOnMove",
  Open = "actionOnOpen"
}
