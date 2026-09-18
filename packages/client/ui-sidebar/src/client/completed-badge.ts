/**
 * Unread Completed count forwarded to the desktop Host. The reminder bit lives
 * on each session-list row; this module only counts it.
 */

/**
 * Count listed Sessions that still carry the Completed reminder.
 * @param byId - current session-list rows.
 * @returns the unread Completed count.
 */
export function unreadCompletedCount(
  byId: { readonly [sessionId: string]: { readonly completed?: boolean } | undefined },
): number {
  let count = 0
  for (const row of Object.values(byId)) {
    if (row.completed === true) count += 1
  }
  return count
}
