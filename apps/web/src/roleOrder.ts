import type { Role } from "@squorli/protocol";

/** Only reorder editable roles; the default role and the actor's hierarchy boundary stay fixed. */
export function roleOrder(roles: readonly Role[], id: string, targetId: string, after: boolean, ceiling: number) {
  const editable = roles.filter((r) => !r.isDefault && r.position < ceiling).sort((a, b) => b.position - a.position);
  const source = editable.find((r) => r.id === id);
  if (!source || id === targetId || !editable.some((r) => r.id === targetId)) return [];
  const ordered = editable.filter((r) => r.id !== id);
  ordered.splice(ordered.findIndex((r) => r.id === targetId) + Number(after), 0, source);
  if (ordered.every((r, i) => r.id === editable[i]?.id)) return [];
  // Preserve existing rank values where possible; repair ties from newly created roles.
  const slots = editable.map((r) => r.position).reverse();
  for (let i = 0; i < slots.length; i++) slots[i] = Math.max(slots[i]!, (slots[i - 1] ?? 0) + 1);
  if (slots.at(-1)! >= ceiling) return null;
  return ordered.map((r, i) => ({ id: r.id, position: slots[slots.length - 1 - i]! }))
    .filter((patch) => roles.find((r) => r.id === patch.id)?.position !== patch.position);
}
