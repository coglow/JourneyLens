import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerJourneyRoutes } from './routes.js';

it('移除模拟受众读取入口，手动资料仍按入口分群判断且不查询受众', async () => {
  const journeyId = '00000000-0000-4000-8402-000000000001';
  const findJourney = vi.fn().mockResolvedValue({
    id: journeyId,
    segment: {
      id: '00000000-0000-4000-8401-000000000001',
      name: '成年用户',
      rules: { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gte', right: 18 },
    },
  });
  const readAudience = vi.fn(() => {
    throw new Error('手动模拟不应读取受众');
  });
  const prisma = {
    journey: { findUnique: findJourney },
    audienceUser: { findUnique: readAudience, findMany: readAudience, count: readAudience },
  } as unknown as PrismaClient;
  const app = Fastify();
  registerJourneyRoutes(app, prisma);
  try {
    for (const path of [
      'simulation-users',
      'simulation-users/00000000-0000-4000-8403-000000000001',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/journeys/${journeyId}/${path}`,
      });
      expect(response.statusCode).toBe(404);
    }
    const draftDefinition = {
      layoutDirection: 'vertical',
      nodes: [
        {
          id: 'start',
          name: '开始',
          type: 'start',
          position: { x: 0, y: 0 },
          entryBehavior: 'app_session_started',
        },
        { id: 'end', name: '结束', type: 'end', position: { x: 0, y: 100 }, note: null },
      ],
      edges: [{ id: 'edge', source: 'start', target: 'end' }],
    };
    for (const age of [25, 17]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/journeys/${journeyId}/simulate`,
        payload: {
          draftDefinition,
          scenario: {
            user: { displayName: '手动样例', email: null, attributes: { age } },
            entryEvent: { id: 'entry', type: 'app_session_started', offsetSeconds: 0, payload: {} },
            historicalEvents: [],
            scheduledEvents: [],
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        outcome: age >= 18 ? 'completed' : 'not_entered',
        user: { displayName: '手动样例' },
        admission: { segment: { matched: age >= 18 } },
      });
    }
    expect(findJourney).toHaveBeenCalledTimes(2);
    expect(readAudience).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
