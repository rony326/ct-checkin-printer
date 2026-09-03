import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { labelLayoutAlso, labelLayouts } from '../db/schema.js';

export type LabelLayoutRow = typeof labelLayouts.$inferSelect;

/**
 * Findet für einen eingehenden Check-in-Job (Ziel-Drucker + `checkin.type`)
 * das zuständige Layout ("Route", siehe `label_layouts`) plus alle über
 * `label_layout_also` verknüpften Zusatz-Layouts (v1s `also[]`, siehe
 * label-router.js) — diese können auf einen ANDEREN Drucker zeigen als das
 * Primär-Layout. Gibt `[]` zurück, wenn kein Layout für diesen Drucker+Typ
 * konfiguriert ist (mirrors v1: "Kein Route für Label-Typ ... übersprungen").
 */
export function resolveLayoutsForJob(db: Db, printerId: number, ctTypeKey: string): LabelLayoutRow[] {
  const primary = db
    .select()
    .from(labelLayouts)
    .where(eq(labelLayouts.printerId, printerId))
    .all()
    .find((layout) => layout.ctTypeKey === ctTypeKey);
  if (!primary) return [];

  const alsoIds = db
    .select({ alsoLayoutId: labelLayoutAlso.alsoLayoutId })
    .from(labelLayoutAlso)
    .where(eq(labelLayoutAlso.layoutId, primary.id))
    .all()
    .map((r) => r.alsoLayoutId);
  if (alsoIds.length === 0) return [primary];

  const alsoLayouts = db.select().from(labelLayouts).where(inArray(labelLayouts.id, alsoIds)).all();
  // Reihenfolge von alsoIds beibehalten, fehlende (gelöschte) Layouts überspringen.
  const byId = new Map(alsoLayouts.map((l) => [l.id, l]));
  const ordered = alsoIds.map((id) => byId.get(id)).filter((l): l is LabelLayoutRow => l !== undefined);

  return [primary, ...ordered];
}
