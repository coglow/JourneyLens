import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  startTestDatabase,
  testAccountId,
  testNow,
  type TestDatabase,
} from '../test-support/test-database.js';
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

const campaignId = '00000000-0000-4000-8600-000000000001';
const emptyCampaignId = '00000000-0000-4000-8600-000000000002';
const unpublishedCampaignId = '00000000-0000-4000-8600-000000000003';
const draftOnlyCampaignId = '00000000-0000-4000-8600-000000000004';
const scheduledCampaignId = '00000000-0000-4000-8600-000000000005';
const journeyId = '00000000-0000-4000-8601-000000000001';
const unpublishedJourneyId = '00000000-0000-4000-8601-000000000002';
const draftJourneyId = '00000000-0000-4000-8601-000000000003';
const missingId = '00000000-0000-4000-8699-000000000001';

// 开始 → 邮件 → 结束：完整连接、没有流程警告，可直接发布。
function definitionWithBody(body: string) {
  return {
    layoutDirection: 'vertical',
    nodes: [
      {
        id: 'n-start',
        type: 'start',
        name: '开始',
        position: { x: 0, y: 0 },
        entryBehavior: 'app_session_started',
      },
      {
        id: 'n-message',
        type: 'message',
        name: '发送邮件',
        position: { x: 0, y: 140 },
        channel: 'email',
        subject: '启停验收',
        body,
      },
      { id: 'n-end', type: 'end', name: '结束', position: { x: 0, y: 280 }, note: null },
    ],
    edges: [
      { id: 'e-start', source: 'n-start', target: 'n-message' },
      { id: 'e-end', source: 'n-message', target: 'n-end' },
    ],
  };
}

const completeDefinition = definitionWithBody('已发布正文');

async function seedCampaign(
  id = campaignId,
  status: 'draft' | 'scheduled' | 'paused' | 'running' | 'stopped' = 'draft',
  name = '启停验收活动',
): Promise<void> {
  await db.prisma.campaign.create({
    data: { id, name, status, createdById: testAccountId, createdAt: testNow, updatedAt: testNow },
  });
}

async function seedJourney(
  id = journeyId,
  targetCampaignId = campaignId,
  options: { name?: string; revision?: number; draftDefinition?: unknown | null } = {},
): Promise<void> {
  await db.prisma.journey.create({
    data: {
      id,
      campaignId: targetCampaignId,
      name: options.name ?? '启停旅程',
      revision: options.revision ?? 1,
      draftDefinition:
        options.draftDefinition === undefined
          ? (completeDefinition as Prisma.InputJsonValue)
          : options.draftDefinition === null
            ? Prisma.DbNull
            : (options.draftDefinition as Prisma.InputJsonValue),
      createdById: testAccountId,
      updatedById: testAccountId,
      createdAt: testNow,
      updatedAt: testNow,
    },
  });
}

/** 直接写入一条发布版本：启动门槛只关心“是否存在”，版本内容是发布模块的职责。 */
async function seedVersion(targetJourneyId = journeyId, body = '已发布正文'): Promise<void> {
  await db.prisma.journeyVersion.create({
    data: {
      journeyId: targetJourneyId,
      versionNumber: 1,
      sourceRevision: 1,
      sourceSegmentRevision: null,
      snapshot: {
        name: '启停旅程',
        description: null,
        entrySegment: null,
        definition: definitionWithBody(body),
      } as unknown as Prisma.InputJsonValue,
      publishedById: testAccountId,
      publishedAt: testNow,
    },
  });
}

function startCampaign(
  app: TestApp,
  cookie: string,
  id = campaignId,
  payload: unknown = {},
  origin = 'http://localhost',
) {
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${id}/start`,
    headers: { ...jsonHeaders(cookie), origin },
    payload: JSON.stringify(payload),
  });
}

function stopCampaign(app: TestApp, cookie: string, id = campaignId) {
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${id}/stop`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({}),
  });
}

function pauseCampaign(app: TestApp, cookie: string, id = campaignId) {
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${id}/pause`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({}),
  });
}

function resumeCampaign(app: TestApp, cookie: string, id = campaignId) {
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${id}/resume`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({}),
  });
}

function createJourney(app: TestApp, cookie: string, campaign: string, name: string) {
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaign}/journeys`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({ name }),
  });
}

function publishJourney(app: TestApp, cookie: string, id: string, revision: number) {
  return app.inject({
    method: 'POST',
    url: `/api/journeys/${id}/publish`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({ revision, segmentRevision: null }),
  });
}

function patchCampaign(app: TestApp, cookie: string, id = campaignId) {
  return app.inject({
    method: 'PATCH',
    url: `/api/campaigns/${id}`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({ name: '启动后改名' }),
  });
}

function putDraft(app: TestApp, cookie: string, id: string, revision: number) {
  return app.inject({
    method: 'PUT',
    url: `/api/journeys/${id}/draft`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({ revision, draftDefinition: completeDefinition }),
  });
}

function deleteWithCookie(app: TestApp, cookie: string, url: string) {
  return app.inject({
    method: 'DELETE',
    url,
    headers: { host: 'localhost', origin: 'http://localhost', cookie },
  });
}

async function statusOf(id: string) {
  const campaign = await db.prisma.campaign.findUnique({ where: { id }, select: { status: true } });
  return campaign?.status;
}

/** 断言请求在指定时间内没有返回：说明它确实在等活动行锁，而不是恰好串行执行。 */
async function expectStillPending(request: Promise<unknown>): Promise<void> {
  let settled = false;
  void Promise.resolve(request).then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(settled).toBe(false);
}

describe('活动启停', () => {
  it('有已发布旅程时可以启动、停止，状态与详情一致', async () => {
    await seedCampaign();
    await seedJourney();
    await seedVersion();

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      const started = await startCampaign(app, cookie);
      expect(started.statusCode).toBe(200);
      expect(started.json().data).toMatchObject({ id: campaignId, status: 'running' });
      expect(await statusOf(campaignId)).toBe('running');

      const stopped = await stopCampaign(app, cookie);
      expect(stopped.statusCode).toBe(200);
      expect(stopped.json().data).toMatchObject({ id: campaignId, status: 'stopped' });
      expect(await statusOf(campaignId)).toBe('stopped');

      const detail = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${campaignId}`,
        headers: { cookie },
      });
      expect(detail.json().data.status).toBe('stopped');
    } finally {
      await app.close();
    }
  });

  it('没有已发布版本时拒绝启动，状态保持草稿', async () => {
    await seedCampaign(emptyCampaignId, 'draft', '没有旅程');
    await seedCampaign(unpublishedCampaignId, 'draft', '只有未发布旅程');
    await seedJourney(unpublishedJourneyId, unpublishedCampaignId, {
      name: '未发布旅程',
      draftDefinition: null,
    });
    await seedCampaign(draftOnlyCampaignId, 'draft', '只有完整草稿');
    await seedJourney(draftJourneyId, draftOnlyCampaignId, { name: '完整草稿' });

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      for (const id of [emptyCampaignId, unpublishedCampaignId, draftOnlyCampaignId]) {
        const response = await startCampaign(app, cookie, id);
        expect(response.statusCode).toBe(409);
        expect(response.json().error).toMatchObject({
          code: 'CAMPAIGN_HAS_NO_PUBLISHED_JOURNEY',
          message: '请先发布至少一个旅程，再启动活动',
        });
        expect(await statusOf(id)).toBe('draft');
      }
    } finally {
      await app.close();
    }
  });

  it('一个已发布旅程即可启动，发布后的草稿修改不参与启动', async () => {
    await seedCampaign();
    await seedJourney(journeyId, campaignId, { name: '已发布旅程' });
    await seedJourney(unpublishedJourneyId, campaignId, {
      name: '未发布旅程',
      draftDefinition: null,
    });
    await seedVersion();
    // 发布后继续改草稿：启动不要求重新发布，也不改动已冻结的版本内容。
    const editedDefinition = definitionWithBody('发布后修改的草稿');
    await db.prisma.journey.update({
      where: { id: journeyId },
      data: { revision: 2, draftDefinition: editedDefinition as Prisma.InputJsonValue },
    });
    const versionBefore = await db.prisma.journeyVersion.findFirst({ where: { journeyId } });

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const response = await startCampaign(app, cookie);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('running');

      const versionAfter = await db.prisma.journeyVersion.findFirst({ where: { journeyId } });
      expect(versionAfter?.snapshot).toEqual(versionBefore?.snapshot);
      const journey = await db.prisma.journey.findUnique({ where: { id: journeyId } });
      expect(journey?.draftDefinition).toEqual(editedDefinition);
      expect(journey?.revision).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('重复启停不更新时间，已停止不能再次启动，其他非法流转被拒绝', async () => {
    await seedCampaign();
    await seedJourney();
    await seedVersion();
    await seedCampaign(emptyCampaignId, 'draft', '草稿活动');
    await seedCampaign(scheduledCampaignId, 'scheduled', '已排期活动');

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      const first = await startCampaign(app, cookie);
      const firstUpdatedAt = first.json().data.updatedAt as string;
      const repeatedStart = await startCampaign(app, cookie);
      expect(repeatedStart.statusCode).toBe(200);
      expect(repeatedStart.json().data.updatedAt).toBe(firstUpdatedAt);

      const stopped = await stopCampaign(app, cookie);
      const stoppedAt = stopped.json().data.updatedAt as string;
      const repeatedStop = await stopCampaign(app, cookie);
      expect(repeatedStop.statusCode).toBe(200);
      expect(repeatedStop.json().data.updatedAt).toBe(stoppedAt);

      const restart = await startCampaign(app, cookie);
      expect(restart.statusCode).toBe(409);
      expect(restart.json().error).toMatchObject({
        code: 'CAMPAIGN_INVALID_TRANSITION',
        message: '活动已停止，不能再次启动',
      });
      expect(await statusOf(campaignId)).toBe('stopped');

      const draftStop = await stopCampaign(app, cookie, emptyCampaignId);
      expect(draftStop.statusCode).toBe(409);
      expect(draftStop.json().error).toMatchObject({
        code: 'CAMPAIGN_INVALID_TRANSITION',
        message: '只有进行中或已暂停的活动可以停止',
      });

      const scheduledStart = await startCampaign(app, cookie, scheduledCampaignId);
      expect(scheduledStart.statusCode).toBe(409);
      expect(scheduledStart.json().error).toMatchObject({
        code: 'CAMPAIGN_INVALID_TRANSITION',
        message: '当前活动不能启动，请刷新后查看',
      });
    } finally {
      await app.close();
    }
  });

  it('启停沿用登录与请求来源保护，非法输入被拒绝', async () => {
    await seedCampaign();
    await seedJourney();
    await seedVersion();

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      const unauthenticated = await app.inject({
        method: 'POST',
        url: `/api/campaigns/${campaignId}/start`,
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({}),
      });
      expect(unauthenticated.statusCode).toBe(401);

      const badOrigin = await startCampaign(
        app,
        cookie,
        campaignId,
        {},
        'https://elsewhere.example',
      );
      expect(badOrigin.statusCode).toBe(403);

      expect((await startCampaign(app, cookie, 'not-a-uuid')).statusCode).toBe(400);
      expect((await startCampaign(app, cookie, campaignId, { status: 'stopped' })).statusCode).toBe(
        400,
      );
      expect((await startCampaign(app, cookie, missingId)).statusCode).toBe(404);
      expect(await statusOf(campaignId)).toBe('draft');
    } finally {
      await app.close();
    }
  });

  it('进行中和已停止时活动和旅程写入都被拒绝，读取仍可用', async () => {
    await seedCampaign();
    await seedJourney(journeyId, campaignId, { name: '已发布旅程' });
    await seedJourney(unpublishedJourneyId, campaignId, {
      name: '未发布旅程',
      draftDefinition: null,
    });
    await seedVersion();

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      expect((await startCampaign(app, cookie)).statusCode).toBe(200);

      const campaignRejected = await patchCampaign(app, cookie);
      expect(campaignRejected.statusCode).toBe(409);
      expect(campaignRejected.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以修改',
      });
      const campaignDelete = await deleteWithCookie(app, cookie, `/api/campaigns/${campaignId}`);
      expect(campaignDelete.statusCode).toBe(409);
      expect(campaignDelete.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_DRAFT',
        message: '只有草稿活动可以删除',
      });

      const created = await createJourney(app, cookie, campaignId, '启动后新建旅程');
      expect(created.statusCode).toBe(409);
      expect(created.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以新建旅程',
      });

      const journeyRejected = await app.inject({
        method: 'PATCH',
        url: `/api/journeys/${unpublishedJourneyId}`,
        headers: jsonHeaders(cookie),
        payload: JSON.stringify({ revision: 1, name: '启动后改名' }),
      });
      expect(journeyRejected.statusCode).toBe(409);
      expect(journeyRejected.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以修改旅程',
      });

      const draftRejected = await putDraft(app, cookie, unpublishedJourneyId, 1);
      expect(draftRejected.statusCode).toBe(409);
      expect(draftRejected.json().error.code).toBe('CAMPAIGN_NOT_EDITABLE');

      const journeyDelete = await deleteWithCookie(
        app,
        cookie,
        `/api/journeys/${unpublishedJourneyId}`,
      );
      expect(journeyDelete.statusCode).toBe(409);
      expect(journeyDelete.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以删除旅程',
      });

      const published = await publishJourney(app, cookie, unpublishedJourneyId, 1);
      expect(published.statusCode).toBe(409);
      expect(published.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以发布旅程',
      });

      for (const url of [
        `/api/campaigns/${campaignId}`,
        `/api/campaigns/${campaignId}/journeys`,
        `/api/journeys/${journeyId}/versions`,
      ]) {
        const response = await app.inject({ method: 'GET', url, headers: { cookie } });
        expect(response.statusCode).toBe(200);
      }

      expect((await stopCampaign(app, cookie)).statusCode).toBe(200);
      expect((await patchCampaign(app, cookie)).statusCode).toBe(409);
      expect((await putDraft(app, cookie, unpublishedJourneyId, 1)).statusCode).toBe(409);
      const deletedAfterStop = await deleteWithCookie(app, cookie, `/api/campaigns/${campaignId}`);
      expect(deletedAfterStop.statusCode).toBe(409);
      expect(deletedAfterStop.json().error.code).toBe('CAMPAIGN_NOT_DRAFT');
      expect(await statusOf(campaignId)).toBe('stopped');
    } finally {
      await app.close();
    }
  });

  it('启动等待进行中的旅程写入，提交后才能启动', async () => {
    await seedCampaign();
    await seedJourney();
    await seedVersion();

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      let locked!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const holdLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      // 测试自己持有活动行的共享锁，相当于另一个页面正在保存旅程草稿。
      const holding = db.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "status" FROM "campaigns" WHERE "id" = ${campaignId}::uuid FOR SHARE`;
        locked();
        await holdLock;
      });
      await lockAcquired;

      const pending = startCampaign(app, cookie);
      await expectStillPending(pending);

      release();
      await holding;

      const response = await pending;
      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('running');
    } finally {
      await app.close();
    }
  });

  it('旅程保存等待进行中的启动，提交后拒绝保存', async () => {
    await seedCampaign();
    await seedJourney(journeyId, campaignId, { name: '等待启动的旅程', draftDefinition: null });

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      let locked!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const holdLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      // 测试自己持有排他锁并改成进行中，相当于启停在旅程保存之前已取得锁。
      const holding = db.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "status" FROM "campaigns" WHERE "id" = ${campaignId}::uuid FOR UPDATE`;
        await tx.campaign.update({ where: { id: campaignId }, data: { status: 'running' } });
        locked();
        await holdLock;
      });
      await lockAcquired;

      const pending = putDraft(app, cookie, journeyId, 1);
      await expectStillPending(pending);

      release();
      await holding;

      const response = await pending;
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以修改旅程',
      });
      const journey = await db.prisma.journey.findUnique({ where: { id: journeyId } });
      expect(journey?.revision).toBe(1);
      expect(journey?.draftDefinition).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('暂停、恢复与停止按状态表处理，重复动作不写库', async () => {
    await seedCampaign();
    await seedJourney();
    await seedVersion();
    await seedCampaign(emptyCampaignId, 'draft', '草稿活动');
    await seedCampaign(scheduledCampaignId, 'scheduled', '已排期活动');

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      expect((await startCampaign(app, cookie)).statusCode).toBe(200);

      const paused = await pauseCampaign(app, cookie);
      expect(paused.statusCode).toBe(200);
      expect(paused.json().data).toMatchObject({ id: campaignId, status: 'paused' });
      const pausedAt = paused.json().data.updatedAt as string;
      expect(await statusOf(campaignId)).toBe('paused');

      // 已处于暂停：重复暂停返回详情，不重复写时间。
      const repeatedPause = await pauseCampaign(app, cookie);
      expect(repeatedPause.statusCode).toBe(200);
      expect(repeatedPause.json().data.updatedAt).toBe(pausedAt);

      // 暂停不能走首次启动，必须恢复。
      const startWhilePaused = await startCampaign(app, cookie);
      expect(startWhilePaused.statusCode).toBe(409);
      expect(startWhilePaused.json().error).toMatchObject({
        code: 'CAMPAIGN_INVALID_TRANSITION',
        message: '活动已暂停，请使用恢复活动',
      });

      const resumed = await resumeCampaign(app, cookie);
      expect(resumed.statusCode).toBe(200);
      expect(resumed.json().data.status).toBe('running');
      const resumedAt = resumed.json().data.updatedAt as string;
      const repeatedResume = await resumeCampaign(app, cookie);
      expect(repeatedResume.statusCode).toBe(200);
      expect(repeatedResume.json().data.updatedAt).toBe(resumedAt);

      // 暂停后停止进入终态。
      expect((await pauseCampaign(app, cookie)).statusCode).toBe(200);
      const stopped = await stopCampaign(app, cookie);
      expect(stopped.statusCode).toBe(200);
      expect(stopped.json().data.status).toBe('stopped');
      expect(await statusOf(campaignId)).toBe('stopped');

      const resumeAfterStop = await resumeCampaign(app, cookie);
      expect(resumeAfterStop.statusCode).toBe(409);
      expect(resumeAfterStop.json().error).toMatchObject({
        code: 'CAMPAIGN_INVALID_TRANSITION',
        message: '活动已停止，不能恢复',
      });
      const pauseAfterStop = await pauseCampaign(app, cookie);
      expect(pauseAfterStop.statusCode).toBe(409);
      expect(pauseAfterStop.json().error).toMatchObject({
        code: 'CAMPAIGN_INVALID_TRANSITION',
        message: '活动已停止，不能暂停',
      });

      // 草稿不能暂停或恢复。
      const draftPause = await pauseCampaign(app, cookie, emptyCampaignId);
      expect(draftPause.statusCode).toBe(409);
      expect(draftPause.json().error).toMatchObject({
        code: 'CAMPAIGN_INVALID_TRANSITION',
        message: '当前活动不能暂停，请刷新后查看',
      });
      const draftResume = await resumeCampaign(app, cookie, emptyCampaignId);
      expect(draftResume.statusCode).toBe(409);
      expect(draftResume.json().error).toMatchObject({
        code: 'CAMPAIGN_INVALID_TRANSITION',
        message: '当前活动不能恢复，请刷新后查看',
      });

      // 已排期不接受任何新动作。
      for (const action of [pauseCampaign, resumeCampaign, stopCampaign]) {
        const response = await action(app, cookie, scheduledCampaignId);
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe('CAMPAIGN_INVALID_TRANSITION');
      }
      expect(await statusOf(scheduledCampaignId)).toBe('scheduled');
    } finally {
      await app.close();
    }
  });

  it('暂停期间可以维护活动资料和旅程，发布生成新版本并保留旧版', async () => {
    await seedCampaign();
    await seedJourney(journeyId, campaignId, { name: '已发布旅程' });
    await seedJourney(unpublishedJourneyId, campaignId, {
      name: '待清理旅程',
      draftDefinition: null,
    });
    await seedVersion();

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      expect((await startCampaign(app, cookie)).statusCode).toBe(200);
      expect((await pauseCampaign(app, cookie)).statusCode).toBe(200);

      // 暂停下可以修改活动资料。
      const renamed = await patchCampaign(app, cookie);
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().data).toMatchObject({ name: '启动后改名', status: 'paused' });

      // 暂停下新建旅程，保存后发布第 1 版。
      const created = await createJourney(app, cookie, campaignId, '暂停后新增旅程');
      expect(created.statusCode).toBe(201);
      expect(created.json().data).toMatchObject({ revision: 1, draftDefinition: null });
      const newJourneyId = created.json().data.id as string;
      expect((await putDraft(app, cookie, newJourneyId, 1)).statusCode).toBe(200);
      const newVersion = await publishJourney(app, cookie, newJourneyId, 2);
      expect(newVersion.statusCode).toBe(201);
      expect(newVersion.json().data).toMatchObject({ versionNumber: 1, sourceRevision: 2 });

      // 已有旅程修改后发布第 2 版，第 1 版内容保持不变。
      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/journeys/${journeyId}`,
        headers: jsonHeaders(cookie),
        payload: JSON.stringify({ revision: 1, name: '修正后的旅程' }),
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().data.revision).toBe(2);
      expect((await putDraft(app, cookie, journeyId, 2)).statusCode).toBe(200);
      const secondVersion = await publishJourney(app, cookie, journeyId, 3);
      expect(secondVersion.statusCode).toBe(201);
      expect(secondVersion.json().data.versionNumber).toBe(2);

      const versions = await db.prisma.journeyVersion.findMany({
        where: { journeyId },
        orderBy: { versionNumber: 'asc' },
      });
      expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
      expect(versions[0]?.snapshot).toMatchObject({
        definition: definitionWithBody('已发布正文'),
      });

      // 从未发布的旅程可以清理；已有发布版本的旅程仍不能删除。
      expect(
        (await deleteWithCookie(app, cookie, `/api/journeys/${unpublishedJourneyId}`)).statusCode,
      ).toBe(204);
      const blocked = await deleteWithCookie(app, cookie, `/api/journeys/${journeyId}`);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toMatchObject({
        code: 'JOURNEY_HAS_VERSIONS',
        message: '该旅程已有发布版本，不能删除',
      });

      // 暂停仍不能删除整个活动。
      const campaignDelete = await deleteWithCookie(app, cookie, `/api/campaigns/${campaignId}`);
      expect(campaignDelete.statusCode).toBe(409);
      expect(campaignDelete.json().error.code).toBe('CAMPAIGN_NOT_DRAFT');
      expect(await statusOf(campaignId)).toBe('paused');

      // 恢复后维护入口关闭。
      expect((await resumeCampaign(app, cookie)).statusCode).toBe(200);
      const lateCreate = await createJourney(app, cookie, campaignId, '恢复后新建');
      expect(lateCreate.statusCode).toBe(409);
      expect(lateCreate.json().error.code).toBe('CAMPAIGN_NOT_EDITABLE');
      const lateSave = await putDraft(app, cookie, newJourneyId, 3);
      expect(lateSave.statusCode).toBe(409);
      expect(lateSave.json().error.code).toBe('CAMPAIGN_NOT_EDITABLE');
    } finally {
      await app.close();
    }
  });

  it('恢复等待进行中的旅程维护，提交后才能恢复', async () => {
    await seedCampaign();
    await seedJourney();
    await seedVersion();

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      expect((await startCampaign(app, cookie)).statusCode).toBe(200);
      expect((await pauseCampaign(app, cookie)).statusCode).toBe(200);

      let locked!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const holdLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      // 测试自己持有活动行的共享锁，相当于暂停期间另一个页面正在保存旅程。
      const holding = db.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "status" FROM "campaigns" WHERE "id" = ${campaignId}::uuid FOR SHARE`;
        locked();
        await holdLock;
      });
      await lockAcquired;

      const pending = resumeCampaign(app, cookie);
      await expectStillPending(pending);

      release();
      await holding;

      const response = await pending;
      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('running');
    } finally {
      await app.close();
    }
  });
});
