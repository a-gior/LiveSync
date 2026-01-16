/**
 * OS detection for local and remote systems
 */

import type { OS } from './types';

/**
 * Detect local operating system
 */
export function detectLocalOS(): OS {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'darwin';
    default:
      return 'linux';
  }
}

/**
 * Detect remote operating system via SSH command
 * 
 * @param execSSH - Function to execute SSH command
 * @returns Detected OS type
 */
export async function detectRemoteOS(
  execSSH: (cmd: string) => Promise<string>
): Promise<OS> {
  try {
    const result = await execSSH('uname -s 2>/dev/null || echo WINDOWS');
    const output = result.trim().toUpperCase();
    
    if (output.includes('DARWIN')) {
      return 'darwin';
    }
    
    if (output.includes('WINDOWS') || 
        output.includes('CYGWIN') || 
        output.includes('MINGW') ||
        output.includes('MSYS')) {
      return 'windows';
    }
    
    return 'linux';
  } catch {
    // Default to linux if detection fails
    return 'linux';
  }
}