import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { labelLayoutAlso, labelLayouts, printerGroups, printers } from '../db/schema.js';

export type LabelLayoutRow = typeof labelLayouts.$inferSelect;

/**
 * Findet für einen eingehenden Check-in-Job (Ziel-Hostname + `checkin.type`)
 * das zuständige Layout ("Route", siehe `label_layouts`) plus alle über
 * `label_layout_also` verknüpften Zusatz-Layouts (v1s `also[]`, siehe
 * label-router.js) — diese können auf einen ANDEREN Drucker zeigen als das
 * Primär-Layout. Gibt `[]` zurück, wenn kein Layout für diesen Hostnamen+Typ
 * konfiguriert ist (mirrors v1: "Kein Route für Label-Typ ... übersprungen").
 *
 * Gesucht wird über ALLE physischen Beine (`printers`) der `printer_groups`-
 * Zeile mit diesem Hostnamen — mehrere Beine derselben Gruppe bilden einen
 * "virtuellen Drucker" (siehe Spec docs/superpowers/specs/2026-09-04-printer-groups-design.md).
 * So kann z.B. "parent" auf Bein A und "child" auf Bein B als jeweils
 * PRIMÄRES Layout landen, obwohl beide von derselben ChurchTools-Gruppe kommen.
 */
export function resolveLayoutsForJob(db: Db, hostname: string, ctTypeKey: string): LabelLayoutRow[] {
  const group = db.select({ id: printerGroups.id }).from(printerGroups).where(eq(printerGroups.hostname, hostname)).get();
  if (!group) return [];

  const legIds = db
    .select({ id: printers.id })
    .from(printers)
    .where(eq(printers.groupId, group.id))
    .all()
    .map((row) => row.id);
  if (legIds.length === 0) return [];

  const primary = db
    .select()
    .from(labelLayouts)
    .where(inArray(labelLayouts.printerId, legIds))
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
  const byId = new Map(alsoLayouts.map((l) => [l.id, l]));
  const ordered = alsoIds.map((id) => byId.get(id)).filter((l): l is LabelLayoutRow => l !== undefined);

  return [primary, ...ordered];
}
