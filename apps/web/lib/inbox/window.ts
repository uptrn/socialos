/** The inbox shows comments from the last 60 days. */
export const INBOX_DAYS = 60;

export function inboxSince(now = new Date()): string {
  return new Date(now.getTime() - INBOX_DAYS * 86_400_000).toISOString();
}
