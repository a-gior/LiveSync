import type { WorkspaceId } from '@domain/types';
import { Services } from '../../../extension/services';

/**
 * Check if workspace has valid remote config before executing remote commands
 * Shows helpful error message if not valid
 * 
 * @returns true if valid, false if not
 */
export async function requireValidRemoteConfig(
  services: Services, 
  workspaceId: WorkspaceId
): Promise<boolean> {
  // Check cached validation result
  const validationResult = await services.validator.getCached(workspaceId);
  if (!validationResult.isValid) {
    return false;
  }
  
  return true;
}

/**
 * Check if error message is network-related
 */
export function isNetworkError(error?: string): boolean {
  if (!error) {return false;}
  
  // Check for network error keywords and error codes
  const patterns = [
    /econnreset/i,      // Connection reset
    /econnaborted/i,    // Connection aborted
    /econnrefused/i,    // Connection refused
    /enotfound/i,       // DNS lookup failed
    /ehostunreach/i,    // Host unreachable
    /enetunreach/i,     // Network unreachable
    /etimedout/i,       // Timeout
    /epipe/i,           // Broken pipe
    /ehostdown/i,       // Host down
    /enetreset/i,       // Network reset
    /timeout/i,         // Generic timeout
    /unreachable/i,     // Generic unreachable
    /refused/i,         // Generic refused
    /connection/i,      // Generic connection error
  ];
  
  const isConnectionError = patterns.some(pattern => pattern.test(error));
  return isConnectionError;
}