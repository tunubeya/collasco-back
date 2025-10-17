export function buildSort(order?: string): { [key: string]: 'asc' | 'desc' } | undefined {
  if (!order) return undefined;
  const desc = order.startsWith('-');
  const field = desc ? order.slice(1) : order;
  return { [field]: desc ? 'desc' : 'asc' } as { [key: string]: 'asc' | 'desc' };
}

export function clampPageLimit(page = 1, limit = 20) {
  const take = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);
  return { page: safePage, take, skip: (safePage - 1) * take };
}

export function like(value?: string) {
  return value
    ? {
        contains: value,
        mode: 'insensitive' as const,
      }
    : undefined;
}
