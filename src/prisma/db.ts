import 'dotenv/config';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

import { Pool } from 'pg';

let _client: ReturnType<typeof postgres<Contract>> | null = null;
let _pool: Pool | null = null;

export function getDb(): ReturnType<typeof postgres<Contract>> {
  const url = process.env['DATABASE_URL'] || '';

  // FAIL-CLOSED GÜVENLİK SİGORTASI: Test ortamı canlı Supabase'e bağlanamaz
  if (process.env.NODE_ENV === 'test' && url.includes('supabase.com')) {
    throw new Error('SECURITY ALERT: Test environment attempted to connect to live Supabase database! Operation aborted.');
  }

  if (!_client) {
    _client = postgres<Contract>({
      contractJson,
      url,
    });
  }
  return _client;
}

export function getPool(): Pool {
  const url = process.env['DATABASE_URL'] || '';

  if (process.env.NODE_ENV === 'test' && url.includes('supabase.com')) {
    throw new Error('SECURITY ALERT: Test environment attempted to connect to live Supabase database via Pool! Operation aborted.');
  }

  if (!_pool) {
    _pool = new Pool({ connectionString: url });
    _pool.on('error', (err) => {
      console.warn('PostgreSQL idle client disconnected:', err.message);
    });
  }
  return _pool;
}

export function resetDb(): void {
  _client = null;
}

export function resetPool(): void {
  if (_pool) {
    _pool.end().catch(() => {});
    _pool = null;
  }
}

export const db = new Proxy({} as ReturnType<typeof postgres<Contract>>, {
  get(_target, prop, receiver) {
    const client = getDb();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  }
});
