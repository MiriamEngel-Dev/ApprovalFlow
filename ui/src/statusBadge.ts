export const BADGE_CLASS: Record<string, string> = {
  payment_succeeded: 'badge-success',
  approved: 'badge-success',
  auto_approve: 'badge-success',
  payment_failed: 'badge-danger',
  rejected: 'badge-danger',
  reject: 'badge-danger',
  human_review: 'badge-warning',
  info_requested: 'badge-warning',
  pending: 'badge-neutral',
  duplicate: 'badge-neutral',
};

export function badgeClassFor(status: string): string {
  return BADGE_CLASS[status] ?? 'badge-neutral';
}
