/**
 * Windows PowerShell command builder
 * 
 * Uses recursive function to prune excluded directories efficiently
 * Outputs same pipe-delimited format as Linux/macOS commands
 * 
 * NOTE: Each line ends with semicolon for reliable execution even if newlines are stripped
 */

import { escapeForPowerShell } from '../patterns';

/**
 * Build PowerShell count command (fast, no hashing)
 * Uses simple recursive listing - exclusions are approximate for speed
 */
export function buildWindowsCountCommand(
  root: string,
  excludeNames: string[]
): string {
  const escapedRoot = escapeForPowerShell(root);
  
  // Simple approach: just count everything recursively
  // Exclusions are handled during scan, this is just for progress estimation
  if (excludeNames.length === 0) {
    return `@(Get-ChildItem -LiteralPath '${escapedRoot}' -Force -Recurse -ErrorAction SilentlyContinue).Count`;
  }
  
  // With exclusions: filter by name (not perfect for nested, but fast)
  const excludeArray = excludeNames.map(n => `'${escapeForPowerShell(n)}'`).join(',');
  return `@(Get-ChildItem -LiteralPath '${escapedRoot}' -Force -Recurse -ErrorAction SilentlyContinue | Where-Object { @(${excludeArray}) -notcontains $_.Name }).Count`;
}

/**
 * Build PowerShell script for filesystem scanning
 * 
 * @param root - Absolute path to scan (Windows format, e.g., "C:\path")
 * @param excludeNames - Simple names to skip entirely
 * @param includeHashes - Whether to compute SHA256 hashes
 * @returns Complete PowerShell script
 */
export function buildWindowsScanCommand(
  root: string,
  excludeNames: string[],
  includeHashes: boolean
): string {
  const escapedRoot = escapeForPowerShell(root);
  const excludeArray = excludeNames.length > 0
    ? excludeNames.map(n => `'${escapeForPowerShell(n)}'`).join(',')
    : '';
  
  const fileOutput = includeHashes
    ? `$hash = ''; try { $hashResult = Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName -ErrorAction Stop; $hash = $hashResult.Hash.ToLower() } catch { }; Write-Output "$rel|f|$size|$mtime|$hash"`
    : `Write-Output "$rel|f|$size|$mtime|"`;

  return `
$ErrorActionPreference = 'SilentlyContinue';
$root = '${escapedRoot}';
$excludes = @(${excludeArray});
$epoch = [datetime]'1970-01-01T00:00:00Z';
$rootLen = $root.Length;

function Scan-Dir($dir) {
  Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if ($excludes -contains $_.Name) { return };
    $rel = $_.FullName.Substring($rootLen + 1).Replace('\\', '/');
    $mtime = [int64](($_.LastWriteTimeUtc - $epoch).TotalMilliseconds);
    if ($_.PSIsContainer) {
      Write-Output "$rel|d|0|$mtime|";
      Scan-Dir $_.FullName
    } else {
      $size = $_.Length;
      ${fileOutput}
    }
  }
}

Scan-Dir $root
`.trim();
}

/**
 * Escape PowerShell script for SSH command line
 */
export function escapeScriptForSSH(script: string): string {
  // For SSH, wrap in base64 encoding for reliable transmission
  const base64 = Buffer.from(script, 'utf16le').toString('base64');
  return `powershell -NoProfile -NonInteractive -EncodedCommand ${base64}`;
}