import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../auth/routes.js';
import { logos } from '../db/schema.js';
import { getUploadsDir } from '../storage/uploadsDir.js';

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

export async function registerLogoRoutes(app: FastifyInstance) {
  app.get('/api/logos', { preHandler: requireAuth }, async () => {
    return app.db.select({ id: logos.id, name: logos.name, uploadedAt: logos.uploadedAt }).from(logos).all();
  });

  app.post('/api/logos', { preHandler: requireAuth }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Keine Datei hochgeladen' });

    const ext = path.extname(file.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return reply.code(400).send({ error: `Nur ${ALLOWED_EXTENSIONS.join('/')}-Dateien erlaubt` });
    }

    const name = (file.fields.name as { value?: string } | undefined)?.value || file.filename;
    const storedFilename = `${randomUUID()}${ext}`;
    const dir = getUploadsDir(app.env.DB_PATH, 'logos');
    await writeFile(path.join(dir, storedFilename), await file.toBuffer());

    const [row] = app.db.insert(logos).values({ name, filePath: storedFilename }).returning().all();
    return reply.code(201).send(row);
  });

  app.delete('/api/logos/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(logos).where(eq(logos.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Logo nicht gefunden' });

    await unlink(path.join(getUploadsDir(app.env.DB_PATH, 'logos'), row.filePath)).catch(() => {});
    app.db.delete(logos).where(eq(logos.id, id)).run();
    return { ok: true };
  });
}

/** Für Renderer-Aufrufe: logoId -> Bilddaten, siehe LabelRenderer.RenderLabelOptions.logos. */
export async function resolveLogoBuffers(app: FastifyInstance, logoIds: number[]): Promise<Record<number, Buffer>> {
  if (logoIds.length === 0) return {};
  const dir = getUploadsDir(app.env.DB_PATH, 'logos');
  const rows = app.db.select().from(logos).all();
  const result: Record<number, Buffer> = {};
  for (const row of rows) {
    if (logoIds.includes(row.id)) result[row.id] = await readFile(path.join(dir, row.filePath));
  }
  return result;
}
