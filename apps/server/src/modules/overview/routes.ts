import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { OverviewService } from './service.js';

export function registerOverviewRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  now?: () => Date,
): void {
  const service = new OverviewService(prisma, now);
  app.get('/api/overview', async () => ({ data: await service.getSnapshot() }));
}
