import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { labelLayoutAlso, labelLayouts, printers } from '../db/schema.js';

export type LabelLayoutRow = typeof labelLayouts.$inferSelect;

/**
 * Findet für einen eingehenden Check-in-Job (Ziel-Hostname + `checkin.type`)
 * das zuständige Layout ("Route", siehe `label_layouts`) plus alle über
 * `label_layout_also` verknüpften Zusatz-Layouts (v1s `also[]`, siehe
 * label-router.js) — diese können auf einen ANDEREN Drucker zeigen als das
 * Primär-Layout. Gibt `[]` zurück, wenn kein Layout für diesen Hostnamen+Typ
 * konfiguriert ist (mirrors v1: "Kein Route für Label-Typ ... übersprungen").
 *
 * Gesucht wird über ALLE `printers`-Zeilen mit diesem Hostnamen, nicht nur
 * eine — mehrere Zeilen mit demselben Hostnamen bilden einen "virtuellen
 * Drucker" mit mehreren physischen Beinen (siehe `db/schema.ts` Kommentar zu
 * `printers.hostname`, v1-Vorbild: Routing-Modus in printers-config.js). So
 * kann z.B. "parent" auf Drucker A und "child" auf Drucker B als jeweils
 * PRIMÄRES Layout landen, obwohl beide vom selben ChurchTools-Ort kommen.
 */
export function resolveLayoutsForJob(db: Db, hostname: string, ctTypeKey: string): LabelLayoutRow[] {
  const printerIds = db
    .select({ id: printers.id })
    .from(printers)
    .where(eq(printers.hostname, hostname))
    .all()
    .map((row) => row.id);
  if (printerIds.length === 0) return [];

  const primary = db
    .select()
    .from(labelLayouts)
    .where(inArray(labelLayouts.printerId, printerIds))
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
