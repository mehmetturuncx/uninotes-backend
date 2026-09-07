import { Temporal } from '@js-temporal/polyfill';
(globalThis as any).Temporal = Temporal;
import { beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer } from 'testcontainers';
import { execSync } from 'child_process';
import { resetDb, resetPool } from '../src/prisma/db';

let container: any;
let redisContainer: any;

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer('postgres:15-alpine').start();
    process.env.DATABASE_URL = container.getConnectionUri();
    resetDb();
    resetPool();

    redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    process.env.REDIS_HOST = redisContainer.getHost();
    process.env.REDIS_PORT = redisContainer.getMappedPort(6379).toString();
    
    // Tabloları oluştur
    execSync('npx prisma db init', { env: process.env, stdio: 'inherit' });
  } catch (err: any) {
    console.warn('⚠️ Docker container başlatılamadı.', err?.message || err);
    process.env.DATABASE_URL = 'postgresql://disabled:disabled@127.0.0.1:54321/prevent_production_wipe';
    resetDb();
    resetPool();
  }
});

afterAll(async () => {
  resetDb();
  resetPool();
  if (container) await container.stop();
  if (redisContainer) await redisContainer.stop();
});
