type Positioned = { id: string; position: number };

/** Insert relative to a target, then normalize positions (including legacy ties). */
export function reorderItems<T extends Positioned>(items: readonly T[], id: string, targetId: string, after: boolean): T[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const item = sorted.find((entry) => entry.id === id);
  if (!item || id === targetId || !sorted.some((entry) => entry.id === targetId)) return sorted;
  const result = sorted.filter((entry) => entry.id !== id);
  result.splice(result.findIndex((entry) => entry.id === targetId) + Number(after), 0, item);
  return result.map((entry, position) => ({ ...entry, position }));
}
