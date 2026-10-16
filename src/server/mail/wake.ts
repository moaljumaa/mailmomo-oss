// Tiny registry so mutation code can nudge the sync loop without importing it (avoids cycles).
const g = globalThis as unknown as { __mmwake?: Map<string, () => void> };
export const wakers = (g.__mmwake ??= new Map<string, () => void>());
export function wake(accountId: string) {
  wakers.get(accountId)?.();
}
