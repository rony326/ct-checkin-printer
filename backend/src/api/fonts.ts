import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../auth/routes.js';
import { fonts } from '../db/schema.js';
import { getUploadsDir } from '../storage/uploadsDir.js';

const ALLOWED_EXTENSIONS = ['.ttf', '.otf'];

export async function registerFontRoutes(app: FastifyInstance) {
  app.get('/api/fonts', { preHandler: requireAuth }, async () => {
    return app.db.select({ id: fonts.id, name: fonts.name, uploadedAt: fonts.uploadedAt }).from(fonts).all();
  });

  app.post('/api/fonts', { preHandler: requireAuth }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Keine Datei hochgeladen' });

    const ext = path.extname(file.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return reply.code(400).send({ error: `Nur ${ALLOWED_EXTENSIONS.join('/')}-Dateien erlaubt` });
    }

    const name = (file.fields.name as { value?: string } | undefined)?.value || file.filename;
    const storedFilename = `${randomUUID()}${ext}`;
    const dir = getUploadsDir(app.env.DB_PATH, 'fonts');
    await writeFile(path.join(dir, storedFilename), await file.toBuffer());

    const [row] = app.db.insert(fonts).values({ name, filePath: storedFilename }).returning().all();
    return reply.code(201).send(row);
  });

  // Liefert die Rohdaten aus, damit der Browser sie im visuellen Editor per
  // @font-face selbst laden kann (echte Custom-Font auch im interaktiven
  // Entwurfscanvas, nicht nur in der server-gerenderten Live-Vorschau).
  app.get('/api/fonts/:id/file', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(fonts).where(eq(fonts.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Font nicht gefunden' });

    const data = await readFile(path.join(getUploadsDir(app.env.DB_PATH, 'fonts'), row.filePath));
    reply.header('Content-Type', row.filePath.endsWith('.otf') ? 'font/otf' : 'font/ttf');
    return reply.send(data);
  });

  app.delete('/api/fonts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(fonts).where(eq(fonts.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Font nicht gefunden' });

    await unlink(path.join(getUploadsDir(app.env.DB_PATH, 'fonts'), row.filePath)).catch(() => {});
    app.db.delete(fonts).where(eq(fonts.id, id)).run();
    return { ok: true };
  });
}

/** Für Renderer-Aufrufe: fontId -> absoluter Dateipfad, siehe LabelRenderer.RenderLabelOptions.fonts. */
export function resolveFontPaths(app: FastifyInstance, fontIds: number[]): Record<number, string> {
  if (fontIds.length === 0) return {};
  const dir = getUploadsDir(app.env.DB_PATH, 'fonts');
  const rows = app.db.select().from(fonts).all();
  const result: Record<number, string> = {};
  for (const row of rows) {
    if (fontIds.includes(row.id)) result[row.id] = path.join(dir, row.filePath);
  }
  return result;
}
