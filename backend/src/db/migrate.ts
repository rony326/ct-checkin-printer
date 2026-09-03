import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './client.js';
import { loadEnv } from '../env.js';

const env = loadEnv();
const db = createDb(env.DB_PATH);

migrate(db, { migrationsFolder: './migrations' });

console.log(`Migrationen angewendet auf ${env.DB_PATH}`);
