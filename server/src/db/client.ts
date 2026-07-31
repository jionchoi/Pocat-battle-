import { PrismaClient } from '@prisma/client';

import { config } from '../config';

/**
 * The single database connection in the entire system. Nothing else — not the mobile
 * client, not Supabase's auto-API — talks to Postgres.
 *
 * Cached on globalThis so `tsx watch` reloads do not open a new pool on every save and
 * exhaust the pgbouncer connection limit.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isProd ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!config.isProd) globalForPrisma.prisma = prisma;

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
