/**
 * Policy Utilities - Updated for Cleaner ActionPolicy
 */

import type { ActionPolicy } from '@domain/types';

/**
 * Check if policy is no-op (doesn't perform any action)
 * 
 * @param policy - Parsed policy
 * @returns true if policy is 'none' or action is 'skip'
 */
export function isNoOpPolicy(policy: ActionPolicy): boolean {
  return policy.mode === 'none';
}

/**
 * Check if policy is check-only (info message, no action)
 * 
 * @param policy - Parsed policy
 * @returns true if mode is 'check'
 */
export function isCheckOnlyPolicy(policy: ActionPolicy): boolean {
  return policy.mode === 'check';
}

/**
 * Check if policy requires conflict detection
 * 
 * @param policy - Parsed policy
 * @returns true if mode includes 'check'
 */
export function shouldCheckConflict(policy: ActionPolicy): boolean {
  return policy.mode === 'check' || policy.mode === 'check&action';
}

/**
 * Check if policy requires action execution
 * 
 * @param policy - Parsed policy
 * @returns true if mode includes 'action'
 */
export function shouldExecuteAction(policy: ActionPolicy): boolean {
  return policy.mode === 'action' || policy.mode === 'check&action';
}