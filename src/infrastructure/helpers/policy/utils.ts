/**
 * Policy Utilities
 * 
 * Helper functions to make decisions based on parsed policies.
 * Pure functions with no side effects.
 */

import type { ActionPolicy } from '@domain/types';

/**
 * Check if policy is a no-op (does nothing)
 * 
 * @param policy - Parsed policy object
 * @returns true if policy does nothing
 */
export function isNoOpPolicy(policy: ActionPolicy): boolean {
  return !policy.check && !policy.direction && policy.extras.size === 0;
}

/**
 * Check if policy requires fresh remote snapshot
 * 
 * @param policy - Parsed policy object
 * @returns true if remote snapshot should be refreshed
 */
export function requiresRemoteSnapshot(policy: ActionPolicy): boolean {
  // Need remote snapshot if:
  // - Policy checks conflicts (needs to compare with remote)
  // - Policy uploads (needs to verify remote state after)
  return policy.check || policy.direction === 'upload';
}

/**
 * Check if policy requires fresh local snapshot
 * 
 * @param policy - Parsed policy object
 * @returns true if local snapshot should be refreshed
 */
export function requiresLocalSnapshot(policy: ActionPolicy): boolean {
  // Need local snapshot if checking conflicts for downloads
  return policy.check && policy.direction === 'download';
}

/**
 * Check if policy is check-only (no action)
 * 
 * @param policy - Parsed policy object
 * @returns true if policy only checks without taking action
 */
export function isCheckOnlyPolicy(policy: ActionPolicy): boolean {
  return policy.check && !policy.direction && policy.extras.size === 0;
}