import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  startTestDatabase,
  testAccountId,
  testNow,
  type TestDatabase,
} from '../test-support/test-database.js';
import { createAudienceUser } from '../test-support/execution-fixtures.js';
import { jsonHeaders, makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

beforeEach(async () => {
  await db.reset();
});

afterAll(async () => {
  await db?.close();
});

const invalidId = 'not-a-uuid';
const missingId = '00000000-0000-4000-8000-000000000099';

async function createCampaign(name: string) {
  return db.prisma.campaign.create({
    data: { name, status: 'running', createdById: testAccountId },
    select: { id: true },
  });
}

async function createJourney(campaignId: string, name: string) {
  const journey = await db.prisma.journey.create({
    data: {
      campaignId,
      name,
      createdById: testAccountId,
      updatedById: testAccountId,
    },
    select: { id: true },
  });

  async function createVersion(versionNumber: number) {
    const version = await db.prisma.journeyVersion.create({
      data: {
        journeyId: journey.id,
        versionNumber,
        sourceRevision: versionNumber,
        snapshot: {},
        publishedById: testAccountId,
        publishedAt: testNow,
      },
      select: { id: true },
    });
    return version.id;
  }

  return { id: journey.id, createVersion };
}

async function createExecution(input: {
  campaignId: string;
  journeyId: string;
  journeyVersionId: string;
  audienceUserId: string;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'stopped';
}) {
  const event = await db.prisma.event.create({
    data: {
      id: randomUUID(),
      audienceUserId: input.audienceUserId,
      type: 'product_viewed',
      payload: {},
      audienceSnapshot: {},
      receivedAt: testNow,
    },
    select: { id: true },
  });
  return db.prisma.execution.create({
    data: {
      ...input,
      triggerEventId: event.id,
      startedAt: testNow,
    },
    select: { id: true },
  });
}

function getOverview(app: TestApp, cookie: string, campaignId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/campaigns/${campaignId}/overview`,
    headers: { cookie },
  });
}

describe('活动运行概览 API', () => {
  it('统计活动内跨旅程和版本的执行、用户及状态，并区分零值和不存在', async () => {
    const campaign = await createCampaign('运行概览活动');
    const otherCampaign = await createCampaign('另一活动');
    const emptyCampaign = await createCampaign('无执行活动');
    const firstJourney = await createJourney(campaign.id, '第一条旅程');
    const secondJourney = await createJourney(campaign.id, '第二条旅程');
    const otherJourney = await createJourney(otherCampaign.id, '其他活动旅程');
    const firstVersion = await firstJourney.createVersion(1);
    const secondVersion = await firstJourney.createVersion(2);
    const secondJourneyVersion = await secondJourney.createVersion(1);
    const otherVersion = await otherJourney.createVersion(1);
    const firstUser = await createAudienceUser(db, {
      externalId: 'overview:user:one',
      displayName: '第一位用户',
    });
    const secondUser = await createAudienceUser(db, {
      externalId: 'overview:user:two',
      displayName: '第二位用户',
    });

    const executions = await Promise.all([
      createExecution({
        campaignId: campaign.id,
        journeyId: firstJourney.id,
        journeyVersionId: firstVersion,
        audienceUserId: firstUser,
        status: 'running',
      }),
      createExecution({
        campaignId: campaign.id,
        journeyId: firstJourney.id,
        journeyVersionId: firstVersion,
        audienceUserId: firstUser,
        status: 'waiting',
      }),
      createExecution({
        campaignId: campaign.id,
        journeyId: firstJourney.id,
        journeyVersionId: secondVersion,
        audienceUserId: firstUser,
        status: 'completed',
      }),
      createExecution({
        campaignId: campaign.id,
        journeyId: secondJourney.id,
        journeyVersionId: secondJourneyVersion,
        audienceUserId: secondUser,
        status: 'failed',
      }),
      createExecution({
        campaignId: campaign.id,
        journeyId: secondJourney.id,
        journeyVersionId: secondJourneyVersion,
        audienceUserId: secondUser,
        status: 'stopped',
      }),
      createExecution({
        campaignId: otherCampaign.id,
        journeyId: otherJourney.id,
        journeyVersionId: otherVersion,
        audienceUserId: firstUser,
        status: 'running',
      }),
    ]);

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const executionCountBeforeRead = await db.prisma.execution.count();
      const stepCountBeforeRead = await db.prisma.executionStep.count();
      const overview = await getOverview(app, cookie, campaign.id);

      expect(overview.statusCode).toBe(200);
      expect(overview.json()).toEqual({
        data: {
          campaignId: campaign.id,
          executionCount: 5,
          audienceCount: 2,
          statusCounts: { running: 1, waiting: 1, completed: 1, failed: 1, stopped: 1 },
          goalReachedCount: null,
        },
      });
      expect(await db.prisma.execution.count()).toBe(executionCountBeforeRead);
      expect(await db.prisma.executionStep.count()).toBe(stepCountBeforeRead);

      await db.prisma.execution.update({
        where: { id: executions[1]!.id },
        data: { status: 'completed' },
      });
      const advanced = await getOverview(app, cookie, campaign.id);
      expect(advanced.json().data).toMatchObject({
        executionCount: 5,
        audienceCount: 2,
        statusCounts: { running: 1, waiting: 0, completed: 2, failed: 1, stopped: 1 },
      });

      const stop = await app.inject({
        method: 'POST',
        url: `/api/campaigns/${campaign.id}/stop`,
        headers: jsonHeaders(cookie),
        payload: JSON.stringify({}),
      });
      expect(stop.statusCode).toBe(200);
      const stopped = await getOverview(app, cookie, campaign.id);
      expect(stopped.json().data).toMatchObject({
        executionCount: 5,
        audienceCount: 2,
        statusCounts: { running: 0, waiting: 0, completed: 2, failed: 1, stopped: 2 },
      });

      const empty = await getOverview(app, cookie, emptyCampaign.id);
      expect(empty.statusCode).toBe(200);
      expect(empty.json().data).toEqual({
        campaignId: emptyCampaign.id,
        executionCount: 0,
        audienceCount: 0,
        statusCounts: { running: 0, waiting: 0, completed: 0, failed: 0, stopped: 0 },
        goalReachedCount: null,
      });

      const invalid = await getOverview(app, cookie, invalidId);
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.message).toBe('活动链接无效');
      const missing = await getOverview(app, cookie, missingId);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.message).toBe('活动不存在');
      const signedOut = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${campaign.id}/overview`,
      });
      expect(signedOut.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
