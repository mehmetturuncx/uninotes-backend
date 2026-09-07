import { describe, it, expect, afterEach } from 'vitest';
import { getDb, resetDb, getPool, resetPool } from '../src/prisma/db';

describe('Security Guard: Live Database Wipe Prevention', () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.DATABASE_URL = originalUrl;
    process.env.NODE_ENV = originalNodeEnv;
    resetDb();
    resetPool();
  });

  it('getDb() canlı Supabase URL gördüğünde hata fırlatıp bağlantıyı engellemeli', () => {
    resetDb();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://postgres:pass@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';

    expect(() => getDb()).toThrow(/SECURITY ALERT: Test environment attempted to connect to live Supabase database/);
  });

  it('getPool() canlı Supabase URL gördüğünde hata fırlatıp bağlantıyı engellemeli', () => {
    resetPool();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://postgres:pass@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';

    expect(() => getPool()).toThrow(/SECURITY ALERT: Test environment attempted to connect to live Supabase database via Pool/);
  });

  it('getDb() ve getPool() güvenli lokal/container URL ile normal çalışabilmeli', () => {
    resetDb();
    resetPool();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/testdb';

    expect(() => getDb()).not.toThrow();
    expect(() => getPool()).not.toThrow();
  });
});
