import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MediaDefinition } from '../adapters/printer/types.js';
import { requireAuth } from '../auth/routes.js';
import { labelLayoutAlso, labelLayouts, mediaTypes, type LabelElement } from '../db/schema.js';
import { VENDOR_DPI } from '../rendering/dimensions.js';
import { renderLabel } from '../rendering/LabelRenderer.js';
import { buildMockRenderContext } from '../template/variables.js';
import { resolveFontPaths } from './fonts.js';
import { resolveLogoBuffers } from './logos.js';

const textFieldEnum = z.enum(['person.name', 'person.id', 'checkin.code', 'checkin.group', 'checkin.type', 'checkin.extra']);
const alignEnum = z.enum(['left', 'center', 'right']);
const rotateEnum = z.enum(['0', '90', '180', '270']);

const labelElementSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('text'),
    xMm: z.number(),
    yMm: z.number(),
    field: textFieldEnum,
    fontSize: z.number().positive(),
    bold: z.boolean(),
    align: alignEnum,
    fontId: z.number().optional(),
    prefix: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('static'),
    xMm: z.number(),
    yMm: z.number(),
    value: z.string(),
    fontSize: z.number().positive(),
    bold: z.boolean(),
    align: alignEnum,
    fontId: z.number().optional(),
  }),
  z.object({ id: z.string(), type: z.literal('logo'), xMm: z.number(), yMm: z.number(), logoId: z.number(), heightMm: z.number().positive() }),
  z.object({ id: z.string(), type: z.literal('qr'), xMm: z.number(), yMm: z.number(), content: z.enum(['qr:hash', 'qr:personId']), sizeMm: z.number().positive() }),
  z.object({ id: z.string(), type: z.literal('line'), xMm: z.number(), yMm: z.number(), widthMm: z.number().positive(), thicknessMm: z.number().positive() }),
]);

const createLayoutSchema = z.object({
  name: z.string().min(1),
  ctTypeKey: z.string().min(1),
  mediaId: z.number().optional(),
  printerId: z.number().nullable().optional(),
  elementsJson: z.array(labelElementSchema).optional(),
  copies: z.number().int().positive().optional(),
  rotate: rotateEnum.optional(),
  /** Weitere Layouts, die zusätzlich gedruckt werden, wenn dieses gedruckt wird (siehe v1 `also[]`). */
  alsoLayoutIds: z.array(z.number()).optional(),
});

const updateLayoutSchema = createLayoutSchema.partial();

const previewSchema = z.object({ elements: z.array(labelElementSchema), mediaId: z.number() });

export function toMediaDefinition(row: typeof mediaTypes.$inferSelect): MediaDefinition {
  return {
    id: row.externalId,
    vendor: row.vendor,
    name: row.name,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    printableAreaMm: { width: row.printableWidthMm, height: row.printableHeightMm ?? 0 },
    dieCut: row.dieCut,
  };
}

export function getAlsoLayoutIds(app: FastifyInstance, layoutId: number): number[] {
  return app.db
    .select({ alsoLayoutId: labelLayoutAlso.alsoLayoutId })
    .from(labelLayoutAlso)
    .where(eq(labelLayoutAlso.layoutId, layoutId))
    .all()
    .map((r) => r.alsoLayoutId);
}

function setAlsoLayoutIds(app: FastifyInstance, layoutId: number, alsoLayoutIds: number[]): void {
  app.db.delete(labelLayoutAlso).where(eq(labelLayoutAlso.layoutId, layoutId)).run();
  for (const alsoLayoutId of alsoLayoutIds) {
    if (alsoLayoutId === layoutId) continue; // ein Layout kann sich nicht selbst als "auch drucken" referenzieren
    app.db.insert(labelLayoutAlso).values({ layoutId, alsoLayoutId }).run();
  }
}

export function collectFontAndLogoIds(elements: LabelElement[]): { fontIds: number[]; logoIds: number[] } {
  const fontIds = new Set<number>();
  const logoIds = new Set<number>();
  for (const el of elements) {
    if ((el.type === 'text' || el.type === 'static') && el.fontId !== undefined) fontIds.add(el.fontId);
    if (el.type === 'logo') logoIds.add(el.logoId);
  }
  return { fontIds: [...fontIds], logoIds: [...logoIds] };
}

export async function registerLabelLayoutRoutes(app: FastifyInstance) {
  app.get('/api/label-layouts', { preHandler: requireAuth }, async () => {
    return app.db.select().from(labelLayouts).all();
  });

  app.get('/api/label-layouts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(labelLayouts).where(eq(labelLayouts.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Layout nicht gefunden' });
    return { ...row, alsoLayoutIds: getAlsoLayoutIds(app, id) };
  });

  app.post('/api/label-layouts', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createLayoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    if (parsed.data.mediaId !== undefined) {
      const media = app.db.select().from(mediaTypes).where(eq(mediaTypes.id, parsed.data.mediaId)).get();
      if (!media) return reply.code(400).send({ error: 'Unbekannter Medientyp' });
    }

    const { alsoLayoutIds, ...values } = parsed.data;
    const [row] = app.db
      .insert(labelLayouts)
      .values({ ...values, elementsJson: values.elementsJson ?? [] })
      .returning()
      .all();
    if (alsoLayoutIds) setAlsoLayoutIds(app, row!.id, alsoLayoutIds);
    return reply.code(201).send({ ...row, alsoLayoutIds: alsoLayoutIds ?? [] });
  });

  app.put('/api/label-layouts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateLayoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = app.db.select().from(labelLayouts).where(eq(labelLayouts.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Layout nicht gefunden' });

    const { alsoLayoutIds, ...values } = parsed.data;
    app.db
      .update(labelLayouts)
      .set({ ...values, updatedAt: new Date().toISOString() })
      .where(eq(labelLayouts.id, id))
      .run();
    if (alsoLayoutIds !== undefined) setAlsoLayoutIds(app, id, alsoLayoutIds);

    const updated = app.db.select().from(labelLayouts).where(eq(labelLayouts.id, id)).get();
    return { ...updated, alsoLayoutIds: getAlsoLayoutIds(app, id) };
  });

  app.delete('/api/label-layouts/:id', { preHandler: requireAuth }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    app.db.delete(labelLayoutAlso).where(eq(labelLayoutAlso.layoutId, id)).run();
    app.db.delete(labelLayoutAlso).where(eq(labelLayoutAlso.alsoLayoutId, id)).run();
    app.db.delete(labelLayouts).where(eq(labelLayouts.id, id)).run();
    return { ok: true };
  });

  app.post('/api/label-layouts/preview', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const mediaRow = app.db.select().from(mediaTypes).where(eq(mediaTypes.id, parsed.data.mediaId)).get();
    if (!mediaRow) return reply.code(404).send({ error: 'Medientyp nicht gefunden' });

    const { fontIds, logoIds } = collectFontAndLogoIds(parsed.data.elements);
    const [fontPaths, logoBuffers] = await Promise.all([
      Promise.resolve(resolveFontPaths(app, fontIds)),
      resolveLogoBuffers(app, logoIds),
    ]);

    const bitmap = await renderLabel(parsed.data.elements as LabelElement[], toMediaDefinition(mediaRow), buildMockRenderContext(), {
      dpi: VENDOR_DPI[mediaRow.vendor],
      fonts: fontPaths,
      logos: logoBuffers,
    });

    reply.header('Content-Type', 'image/png');
    return reply.send(bitmap.data);
  });
}
