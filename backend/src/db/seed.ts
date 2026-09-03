import { BROTHER_MEDIA } from '../adapters/printer/media/brotherMedia.js';
import { ZEBRA_MEDIA } from '../adapters/printer/media/zebraMedia.js';
import { createDb } from './client.js';
import { mediaTypes } from './schema.js';
import { loadEnv } from '../env.js';

/** Befüllt media_types mit der hardcodierten Referenzliste (siehe Plan, "Medientyp-Referenzlisten"). Idempotent. */
export function seedMediaTypes(db: ReturnType<typeof createDb>) {
  const existing = db.select({ externalId: mediaTypes.externalId }).from(mediaTypes).all();
  const existingIds = new Set(existing.map((row) => row.externalId));

  const allSeeds = [...BROTHER_MEDIA, ...ZEBRA_MEDIA];
  const toInsert = allSeeds.filter((seed) => !existingIds.has(seed.externalId));

  for (const seed of toInsert) {
    db.insert(mediaTypes)
      .values({
        vendor: seed.vendor,
        externalId: seed.externalId,
        name: seed.name,
        widthMm: seed.widthMm,
        heightMm: seed.heightMm,
        printableWidthMm: Math.round(seed.printableAreaMm.width),
        printableHeightMm: seed.printableAreaMm.height ? Math.round(seed.printableAreaMm.height) : null,
        dieCut: seed.dieCut,
      })
      .run();
  }

  return { inserted: toInsert.length, skipped: allSeeds.length - toInsert.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const db = createDb(env.DB_PATH);
  const result = seedMediaTypes(db);
  console.log(`Medientypen: ${result.inserted} eingefügt, ${result.skipped} bereits vorhanden.`);
}
