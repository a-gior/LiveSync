/**
 * Notification Helpers
 * 
 * Helper functions for showing user notifications.
 * Wraps NotificationService for cleaner code.
 */

import * as path from 'path';
import type { RelPath } from '@domain/types';
import type { NotificationStatusBar } from '@presentation/statusbar/NotificationStatusBar';

/**
 * Notify user of successful operation
 * 
 * @param notifications - Notification service
 * @param action - Type of action performed
 * @param relPath - File that was affected
 */
export function notifySuccess(
  notifications: NotificationStatusBar,
  action: 'upload' | 'download' | 'delete' | 'move',
  relPath: RelPath
): void {
  const fileName = path.basename(relPath as string);
  
  switch (action) {
    case 'upload':
      notifications.notify(`Uploaded ${fileName}`, 'cloud-upload');
      break;
    case 'download':
      notifications.notify(`Downloaded ${fileName}`, 'cloud-download');
      break;
    case 'delete':
      notifications.notify(`Deleted ${fileName}`, 'trash');
      break;
    case 'move':
      notifications.notify(`Renamed ${fileName}`, 'edit');
      break;
  }
}

/**
 * Notify user of operation error
 * 
 * @param notifications - Notification service
 * @param action - Type of action that failed
 * @param relPath - File that was affected
 */
export function notifyError(
  notifications: NotificationStatusBar,
  action: 'upload' | 'download' | 'delete' | 'move',
  relPath: RelPath
): void {
  const fileName = path.basename(relPath as string);
  
  notifications.notify(
    `Failed to ${action} ${fileName}`,
    'error'
  );
}

/**
 * Notify user of conflict detection (for check-only policies)
 * 
 * @param notifications - Notification service
 * @param reason - Conflict reason
 */
export function notifyConflict(
  notifications: NotificationStatusBar,
  reason: string
): void {
  notifications.notify(
    `Conflict detected: ${reason}`,
    'warning'
  );
}