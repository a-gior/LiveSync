import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";
import {
  FILE_ICONS_ZIP_PATH,
  FOLDER_ICONS_ZIP_PATH,
  MEDIA_DIR,
} from "../utilities/constants";
import { FileEntryType } from "../utilities/FileEntry";
import * as vscode from "vscode";
import { file } from "tmp";

interface IconMappings {
  [key: string]: {
    extensions: string[];
    filenames: string[];
    languageIds: string[];
  };
}

interface ZipWithMetadata {
  zip: AdmZip;
  path: string;
}

let iconMappings: IconMappings | null = null;
let folderIconMappings: IconMappings | null = null;
let languageIdMappings: { [key: string]: string } | null = null;

const fileIconsZip: ZipWithMetadata = {
  zip: new AdmZip(FILE_ICONS_ZIP_PATH),
  path: FILE_ICONS_ZIP_PATH,
};
const folderIconsZip: ZipWithMetadata = {
  zip: new AdmZip(FOLDER_ICONS_ZIP_PATH),
  path: FOLDER_ICONS_ZIP_PATH,
};

// Cache for language IDs
const languageIdCache: { [key: string]: string } = {};

export function loadIconMappings(jsonFilePath: string) {
  const jsonData = fs.readFileSync(jsonFilePath, "utf8");
  iconMappings = JSON.parse(jsonData);
}

export function loadFolderIconMappings(jsonFilePath: string): void {
  const jsonData = fs.readFileSync(jsonFilePath, "utf8");
  folderIconMappings = JSON.parse(jsonData);
}

export function loadLanguageIdMappings(jsonFilePath: string): void {
  const jsonData = fs.readFileSync(jsonFilePath, "utf8");
  languageIdMappings = JSON.parse(jsonData);
}

function getLanguageIdFromMapping(extension: string): string {
  if (languageIdCache[extension]) {
    return languageIdCache[extension];
  }

  if (!languageIdMappings) {
    throw new Error(
      "LanguageIDs mappings have not been loaded. Call loadLanguageIdMappings first.",
    );
  }

  if (languageIdMappings && languageIdMappings[extension]) {
    const languageId = languageIdMappings[extension];
    languageIdCache[extension] = languageId;
    return languageId;
  }

  return "";
}

function getIcon(
  name: string,
  defaultIconPath: string,
  type: FileEntryType,
  iconMappings: IconMappings,
  fileIconsZip: ZipWithMetadata,
  folderIconsZip: ZipWithMetadata,
): { light: string; dark: string } {
  const zip = type === FileEntryType.file ? fileIconsZip : folderIconsZip;

  // Get the extension name without the dot
  const fileExtension = path.extname(name).toLowerCase().substring(1);
  const basename = path.basename(name, fileExtension).toLowerCase();
  console.log(`DEBUG: getIcon on ${basename}--${fileExtension} `);

  const entries = Object.entries(iconMappings).slice(1); // Skip the first element containing the default value (always true)

  for (const [iconName, mappings] of entries) {
    if (
      mappings.filenames.includes(basename) ||
      mappings.extensions.includes(fileExtension)
    ) {
      console.log("DEBUG: found in ZIP, ", iconName, mappings);
      const lightIconPath = `icons_light/${iconName}${type === FileEntryType.directory ? "_opened" : ""}.svg`;
      const darkIconPath = `icons_dark/${iconName}${type === FileEntryType.directory ? "_opened" : ""}.svg`;

      return {
        light: extractIconFromZip(zip, lightIconPath, darkIconPath),
        dark: extractIconFromZip(zip, darkIconPath),
      };
    }
  }

  console.log(`Set default icon for ${name}.`);
  return {
    light: defaultIconPath,
    dark: defaultIconPath,
  };
  const defaultLightIconPath = `icons_light/${defaultIconPath}`;
  const defaultDarkIconPath = `icons_dark/${defaultIconPath}`;
  return {
    light: extractIconFromZip(zip, defaultLightIconPath, defaultDarkIconPath),
    dark: extractIconFromZip(zip, defaultDarkIconPath),
  };
}

export function getIconForFile(
  filename: string,
  defaultIconPath: string,
): { light: string; dark: string } {
  if (!iconMappings) {
    throw new Error(
      "Icon mappings have not been loaded. Call loadIconMappings first.",
    );
  }

  const fileExtension = path.extname(filename);
  const languageId = getLanguageIdFromMapping(fileExtension);
  console.log(
    `DEBUG JSON: ${fileExtension} ->getLanguageIdFromMapping ${languageId}`,
  );
  if (languageId) {
    for (const [iconName, mappings] of Object.entries(iconMappings)) {
      console.log(`DEBUG JSON: ${iconName}`, mappings);
      if (mappings.languageIds.includes(languageId)) {
        const lightIconPath = `icons_light/${iconName}.svg`;
        const darkIconPath = `icons_dark/${iconName}.svg`;

        return {
          light: extractIconFromZip(fileIconsZip, lightIconPath, darkIconPath),
          dark: extractIconFromZip(fileIconsZip, darkIconPath),
        };
      }
    }
  }

  return getIcon(
    filename,
    defaultIconPath,
    FileEntryType.file,
    iconMappings,
    fileIconsZip,
    folderIconsZip,
  );
}

export function getIconForFolder(
  foldername: string,
  defaultIconPath: string,
): { light: string; dark: string } {
  if (!folderIconMappings) {
    throw new Error(
      "Icon mappings have not been loaded. Call loadIconMappings first.",
    );
  }
  return getIcon(
    foldername,
    defaultIconPath,
    FileEntryType.directory,
    folderIconMappings,
    fileIconsZip,
    folderIconsZip,
  );
}

function extractIconFromZip(
  zipWithMetadata: ZipWithMetadata,
  iconPath: string,
  fallbackIconPath?: string,
): string {
  const { zip, path: zipFilePath } = zipWithMetadata;
  const tempDir = path.join(__dirname, "..", "temp_icons");

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  const tempIconPath = path.join(tempDir, path.basename(iconPath));

  if (fs.existsSync(tempIconPath)) {
    return tempIconPath;
  }

  const entry =
    zip.getEntry(iconPath) ||
    (fallbackIconPath && zip.getEntry(fallbackIconPath));
  if (entry) {
    zip.extractEntryTo(entry, tempDir, false, true);
    return tempIconPath;
  }

  throw new Error(
    `Icon not found in ${zipFilePath}: ${iconPath} - ${fallbackIconPath}`,
  );
}
