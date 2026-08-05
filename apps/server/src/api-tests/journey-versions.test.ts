import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  journeyVersionStatsResponseSchema,
  type ExecutionStatus,
  type ExecutionStepStatus,
  type JourneyNodeType,
} from '@journeylens/shared';
import {
  startTestDatabase,
  testAccountId,
  testNow,
  type TestDatabase,
} from '../test-support/test-database.js';
import { jsonHeaders, makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';
import {
  addTestVersion,
  createAudienceUser,
  fullDefinition,
  minimalDefinition,
  publishTestJourney,
  type TestJourney,
} from '../test-support/execution-fixtures.js';

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

const campaignId = '00000000-0000-4000-8500-000000000001';
const otherCampaignId = '00000000-0000-4000-8500-000000000002';
const segmentId = '00000000-0000-4000-8501-000000000001';
const missingId = '00000000-0000-4000-8599-000000000001';

const ageRule = {
  kind: 'compare',
  left: { source: 'user', path: 'age' },
  operator: 'gte',
  right: 18,
};

const olderAgeRule = {
  kind: 'compare',
  left: { source: 'user', path: 'age' },
  operator: 'gte',
  right: 25,
};

// 开始 → 邮件 → 结束：完整连接、没有流程警告，可直接发布。
function draftWithBody(body: string) {
  return {
    layoutDirection: 'vertical' as const,
    nodes: [
      {
        id: 'n-start',
        type: 'start' as const,
        name: '开始',
        position: { x: 0, y: 0 },
        entryBehavior: 'app_session_started' as const,
      },
      {
        id: 'n-message',
        type: 'message' as const,
        name: '发送邮件',
        position: { x: 0, y: 140 },
        channel: 'email' as const,
        subject: '版本验收',
        body,
      },
      { id: 'n-end', type: 'end' as const, name: '结束', position: { x: 0, y: 280 }, note: null },
    ],
    edges: [
      { id: 'e-start', source: 'n-start', target: 'n-message' },
      { id: 'e-end', source: 'n-message', target: 'n-end' },
    ],
  };
}

const firstDraft = draftWithBody('第一版正文');

async function seedCampaign(
  id = campaignId,
  status: 'draft' | 'running' = 'draft',
  name = '版本发布活动',
): Promise<void> {
  await db.prisma.campaign.create({
    data: { id, name, status, createdById: testAccountId, createdAt: testNow, updatedAt: testNow },
  });
}

async function seedSegment(
  id = segmentId,
  name = '版本验收人群',
  rules: unknown = ageRule,
  revision = 3,
): Promise<void> {
  await db.prisma.segment.create({
    data: {
      id,
      name,
      rules: rules as Prisma.InputJsonValue,
      revision,
      createdById: testAccountId,
      updatedById: testAccountId,
    },
  });
}

function createJourney(
  app: TestApp,
  cookie: string,
  payload: unknown,
  targetCampaignId = campaignId,
) {
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${targetCampaignId}/journeys`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify(payload),
  });
}

function saveDraft(
  app: TestApp,
  cookie: string,
  id: string,
  revision: number,
  draftDefinition: unknown,
) {
  return app.inject({
    method: 'PUT',
    url: `/api/journeys/${id}/draft`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({ revision, draftDefinition }),
  });
}

function publish(app: TestApp, cookie: string, id: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/journeys/${id}/publish`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify(payload),
  });
}

function listVersions(app: TestApp, cookie: string, id: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/journeys/${id}/versions${query}`,
    headers: { cookie },
  });
}

function getVersion(app: TestApp, cookie: string, id: string, versionId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/journeys/${id}/versions/${versionId}`,
    headers: { cookie },
  });
}

function deleteJourney(app: TestApp, cookie: string, id: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/journeys/${id}`,
    headers: { host: 'localhost', origin: 'http://localhost', cookie },
  });
}

/** 建好活动、分群和一条已保存画布的旅程，返回旅程标识与当前修订号。 */
async function seedSavedJourney(
  app: TestApp,
  cookie: string,
  options: { bindSegment?: boolean } = {},
): Promise<{ id: string; revision: number }> {
  await seedCampaign();
  if (options.bindSegment !== false) await seedSegment();
  const created = await createJourney(app, cookie, {
    name: '版本冻结验收',
    description: '验收发布版本',
    segmentId: options.bindSegment === false ? null : segmentId,
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().data.id as string;

  const saved = await saveDraft(app, cookie, id, 1, firstDraft);
  expect(saved.statusCode).toBe(200);
  expect(saved.json().data.revision).toBe(2);
  return { id, revision: 2 };
}

describe('旅程发布与版本冻结', () => {
  it('发布首版冻结名称、说明、画布和入口分群规则，且不改变草稿', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const { id, revision } = await seedSavedJourney(app, cookie);

      const published = await publish(app, cookie, id, { revision, segmentRevision: 3 });
      expect(published.statusCode).toBe(201);
      expect(published.json().data).toMatchObject({
        journeyId: id,
        versionNumber: 1,
        sourceRevision: 2,
        sourceSegmentRevision: 3,
        publishedAt: testNow.toISOString(),
        publishedBy: { id: testAccountId, displayName: '测试运营账号' },
        snapshot: {
          name: '版本冻结验收',
          description: '验收发布版本',
          definition: firstDraft,
          entrySegment: { id: segmentId, name: '版本验收人群', revision: 3, rules: ageRule },
        },
      });

      // 发布只追加版本：草稿内容和旅程修订号都保持不变。
      const stored = await db.prisma.journey.findUnique({ where: { id } });
      expect(stored).toMatchObject({ revision: 2, segmentId, name: '版本冻结验收' });
      expect(stored?.draftDefinition).toEqual(firstDraft);

      const detail = await getVersion(app, cookie, id, published.json().data.id as string);
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data).toEqual(published.json().data);

      const listed = await listVersions(app, cookie, id);
      expect(listed.statusCode).toBe(200);
      expect(listed.json().page).toEqual({ page: 1, pageSize: 10, total: 1 });
      expect(listed.json().data[0]).toEqual({
        id: published.json().data.id,
        journeyId: id,
        versionNumber: 1,
        sourceRevision: 2,
        sourceSegmentRevision: 3,
        publishedAt: testNow.toISOString(),
        publishedBy: { id: testAccountId, displayName: '测试运营账号' },
      });
    } finally {
      await app.close();
    }
  });

  it('同一发布依据重复发布返回原版本，不多生成一版', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const { id, revision } = await seedSavedJourney(app, cookie);

      const first = await publish(app, cookie, id, { revision, segmentRevision: 3 });
      expect(first.statusCode).toBe(201);
      const repeated = await publish(app, cookie, id, { revision, segmentRevision: 3 });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.id).toBe(first.json().data.id);

      expect(await db.prisma.journeyVersion.count({ where: { journeyId: id } })).toBe(1);
      expect((await listVersions(app, cookie, id)).json().page.total).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('草稿和分群分别变化后各生成新版本，旧版本内容保持不变', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const { id, revision } = await seedSavedJourney(app, cookie);
      const first = await publish(app, cookie, id, { revision, segmentRevision: 3 });
      const firstVersionId = first.json().data.id as string;

      const saved = await saveDraft(app, cookie, id, 2, draftWithBody('第二版正文'));
      expect(saved.json().data.revision).toBe(3);
      const second = await publish(app, cookie, id, { revision: 3, segmentRevision: 3 });
      expect(second.statusCode).toBe(201);
      expect(second.json().data.versionNumber).toBe(2);
      expect(second.json().data.snapshot.definition.nodes[1].body).toBe('第二版正文');

      // 只改分群：旅程修订号仍是 3，靠分群修订号识别新的发布依据。
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/segments/${segmentId}`,
        headers: jsonHeaders(cookie),
        payload: JSON.stringify({ revision: 3, rules: olderAgeRule }),
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().data.revision).toBe(4);

      const third = await publish(app, cookie, id, { revision: 3, segmentRevision: 4 });
      expect(third.statusCode).toBe(201);
      expect(third.json().data.versionNumber).toBe(3);
      expect(third.json().data.snapshot.entrySegment.rules).toEqual(olderAgeRule);

      const listed = await listVersions(app, cookie, id);
      expect(
        listed.json().data.map((item: { versionNumber: number }) => item.versionNumber),
      ).toEqual([3, 2, 1]);

      // 旧版本读取的是自己的快照，不受当前分群规则影响。
      const oldest = await getVersion(app, cookie, id, firstVersionId);
      expect(oldest.json().data.snapshot.entrySegment.rules).toEqual(ageRule);
      expect(oldest.json().data.snapshot.definition.nodes[1].body).toBe('第一版正文');
    } finally {
      await app.close();
    }
  });

  it('不限人群的旅程可以发布，分群修订号必须为空', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const { id, revision } = await seedSavedJourney(app, cookie, { bindSegment: false });

      const published = await publish(app, cookie, id, { revision, segmentRevision: null });
      expect(published.statusCode).toBe(201);
      expect(published.json().data.snapshot.entrySegment).toBeNull();

      const mismatched = await publish(app, cookie, id, { revision, segmentRevision: 3 });
      expect(mismatched.statusCode).toBe(409);
      expect(mismatched.json().error).toMatchObject({
        code: 'JOURNEY_SEGMENT_REVISION_CONFLICT',
      });
    } finally {
      await app.close();
    }
  });

  it('没有保存画布、流程不完整或已保存内容无效时拒绝发布', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      await seedCampaign();
      const created = await createJourney(app, cookie, { name: '未保存旅程', segmentId: null });
      const id = created.json().data.id as string;

      const empty = await publish(app, cookie, id, { revision: 1, segmentRevision: null });
      expect(empty.statusCode).toBe(409);
      expect(empty.json().error).toMatchObject({
        code: 'JOURNEY_DRAFT_INCOMPLETE',
        message: '请先保存编排后再发布',
      });

      const incomplete = {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'n-start',
            type: 'start',
            name: '开始',
            position: { x: 0, y: 0 },
            entryBehavior: 'app_session_started',
          },
        ],
        edges: [],
      };
      expect((await saveDraft(app, cookie, id, 1, incomplete)).statusCode).toBe(200);
      const unfinished = await publish(app, cookie, id, { revision: 2, segmentRevision: null });
      expect(unfinished.statusCode).toBe(409);
      expect(unfinished.json().error).toMatchObject({
        code: 'JOURNEY_DRAFT_INCOMPLETE',
        message: '请先补齐流程连接',
      });

      // 直接写入不符合当前结构的内容，模拟旧数据；发布时要用当前契约重新校验。
      await db.prisma.journey.update({
        where: { id },
        data: { draftDefinition: { layoutDirection: 'vertical', nodes: [], edges: [] } },
      });
      const invalid = await publish(app, cookie, id, { revision: 2, segmentRevision: null });
      expect(invalid.statusCode).toBe(409);
      expect(invalid.json().error).toMatchObject({
        code: 'JOURNEY_DRAFT_INVALID',
        message: '该旅程已保存的内容无法用于发布，请重新保存编排',
      });
      expect(await db.prisma.journeyVersion.count({ where: { journeyId: id } })).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('修订号过期的发布依据被拒绝，不冻结未经确认的内容', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const { id } = await seedSavedJourney(app, cookie);

      const staleJourney = await publish(app, cookie, id, { revision: 1, segmentRevision: 3 });
      expect(staleJourney.statusCode).toBe(409);
      expect(staleJourney.json().error.code).toBe('JOURNEY_REVISION_CONFLICT');

      await db.prisma.segment.update({
        where: { id: segmentId },
        data: { revision: { increment: 1 } },
      });
      const staleSegment = await publish(app, cookie, id, { revision: 2, segmentRevision: 3 });
      expect(staleSegment.statusCode).toBe(409);
      expect(staleSegment.json().error.code).toBe('JOURNEY_SEGMENT_REVISION_CONFLICT');
      expect(await db.prisma.journeyVersion.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('不可编辑状态不能发布版本，暂停可以发布新版本', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const { id, revision } = await seedSavedJourney(app, cookie);

      for (const status of ['running', 'stopped'] as const) {
        await db.prisma.campaign.update({ where: { id: campaignId }, data: { status } });
        const blocked = await publish(app, cookie, id, { revision, segmentRevision: 3 });
        expect(blocked.statusCode).toBe(409);
        expect(blocked.json().error).toMatchObject({
          code: 'CAMPAIGN_NOT_EDITABLE',
          message: '只有草稿或已暂停的活动可以发布旅程',
        });
      }
      expect(await db.prisma.journeyVersion.count()).toBe(0);

      // 暂停是维护窗口：修正后可以发布新版本，旧版内容不变。
      await db.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'paused' } });
      const first = await publish(app, cookie, id, { revision, segmentRevision: 3 });
      expect(first.statusCode).toBe(201);
      const firstSnapshot = first.json().data.snapshot;

      const saved = await saveDraft(app, cookie, id, revision, draftWithBody('暂停期间修正的正文'));
      expect(saved.statusCode).toBe(200);
      const second = await publish(app, cookie, id, {
        revision: saved.json().data.revision,
        segmentRevision: 3,
      });
      expect(second.statusCode).toBe(201);
      expect(second.json().data.versionNumber).toBe(2);
      expect(second.json().data.snapshot.definition).toMatchObject({
        nodes: expect.arrayContaining([
          expect.objectContaining({ type: 'message', body: '暂停期间修正的正文' }),
        ]),
      });

      const versions = await db.prisma.journeyVersion.findMany({
        where: { journeyId: id },
        orderBy: { versionNumber: 'asc' },
      });
      expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
      expect(versions[0]?.snapshot).toEqual(firstSnapshot);
    } finally {
      await app.close();
    }
  });

  it('版本查询要求登录，并区分旅程不存在和跨旅程版本', async () => {
    const { app } = makeApp(db);
    try {
      const anonymous = await app.inject({
        method: 'GET',
        url: `/api/journeys/${missingId}/versions`,
      });
      expect(anonymous.statusCode).toBe(401);

      const cookie = await signedInCookie(app);
      const { id, revision } = await seedSavedJourney(app, cookie);
      const published = await publish(app, cookie, id, { revision, segmentRevision: 3 });
      const versionId = published.json().data.id as string;

      const missingJourney = await listVersions(app, cookie, missingId);
      expect(missingJourney.statusCode).toBe(404);
      expect(missingJourney.json().error.message).toBe('旅程不存在');

      await seedCampaign(otherCampaignId, 'draft', '另一个活动');
      const other = await createJourney(
        app,
        cookie,
        { name: '另一条旅程', segmentId: null },
        otherCampaignId,
      );
      const otherId = other.json().data.id as string;
      expect((await saveDraft(app, cookie, otherId, 1, firstDraft)).statusCode).toBe(200);
      const otherPublished = await publish(app, cookie, otherId, {
        revision: 2,
        segmentRevision: null,
      });
      expect(otherPublished.statusCode).toBe(201);

      const crossed = await getVersion(app, cookie, id, otherPublished.json().data.id as string);
      expect(crossed.statusCode).toBe(404);
      expect(crossed.json().error.message).toBe('版本不存在');

      expect((await getVersion(app, cookie, id, versionId)).statusCode).toBe(200);
      expect((await getVersion(app, cookie, id, missingId)).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('版本列表按统一分页规则查询，非法参数明确报错', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      await seedCampaign();
      const created = await createJourney(app, cookie, { name: '分页旅程', segmentId: null });
      const id = created.json().data.id as string;

      // 直接写入 12 个版本，只用于验证列表分页；发布写入口径由其他用例覆盖。
      await db.prisma.journeyVersion.createMany({
        data: Array.from({ length: 12 }, (_, index) => ({
          journeyId: id,
          versionNumber: index + 1,
          sourceRevision: index + 1,
          sourceSegmentRevision: null,
          snapshot: {
            name: '分页旅程',
            description: null,
            definition: firstDraft,
            entrySegment: null,
          } as Prisma.InputJsonValue,
          publishedById: testAccountId,
          publishedAt: new Date(testNow.getTime() + index * 1000),
        })),
      });

      const second = await listVersions(app, cookie, id, '?page=2&pageSize=10');
      expect(second.json().page).toEqual({ page: 2, pageSize: 10, total: 12 });
      expect(
        second.json().data.map((item: { versionNumber: number }) => item.versionNumber),
      ).toEqual([2, 1]);

      const outOfRange = await listVersions(app, cookie, id, '?page=99&pageSize=10');
      expect(outOfRange.json().page).toEqual({ page: 2, pageSize: 10, total: 12 });

      for (const [query, message] of [
        ['?pageSize=5', '每页条数只能选择 10、20 或 50 条'],
        ['?page=0', '页码必须是正整数'],
        ['?page=1&extra=1', '请检查分页条件'],
      ]) {
        const invalid = await listVersions(app, cookie, id, query);
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json().error.message).toBe(message);
      }
    } finally {
      await app.close();
    }
  });

  it('版本不可修改或删除，已有版本的旅程不能删除', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const { id, revision } = await seedSavedJourney(app, cookie);
      const published = await publish(app, cookie, id, { revision, segmentRevision: 3 });
      const versionId = published.json().data.id as string;

      await expect(
        db.prisma.journeyVersion.update({ where: { id: versionId }, data: { versionNumber: 9 } }),
      ).rejects.toThrow();
      await expect(db.prisma.journeyVersion.delete({ where: { id: versionId } })).rejects.toThrow();
      expect(await db.prisma.journeyVersion.count({ where: { id: versionId } })).toBe(1);

      const blocked = await deleteJourney(app, cookie, id);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toMatchObject({
        code: 'JOURNEY_HAS_VERSIONS',
        message: '该旅程已有发布版本，不能删除',
      });
      expect(await db.prisma.journey.count({ where: { id } })).toBe(1);

      // 活动下旅程列表带出版本数量，前端据此禁用删除。
      const listed = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${campaignId}/journeys`,
        headers: { cookie },
      });
      expect(listed.json().data[0]).toMatchObject({ id, versionCount: 1 });

      const plain = await createJourney(app, cookie, { name: '未发布旅程', segmentId: null });
      expect((await deleteJourney(app, cookie, plain.json().data.id as string)).statusCode).toBe(
        204,
      );
    } finally {
      await app.close();
    }
  });

  it('并发发布同一依据只生成一个版本，并等待旅程行锁', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const { id, revision } = await seedSavedJourney(app, cookie);

      // 同步点：先持有旅程行锁，确认发布请求确实在等待数据库锁，而不是靠并发启动的偶然顺序。
      let signalLocked!: () => void;
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      let releaseLock!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const holder = db.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "journeys" WHERE "id" = ${id}::uuid FOR UPDATE`;
        signalLocked();
        await release;
      });
      await locked;

      const pendingPublish = publish(app, cookie, id, { revision, segmentRevision: 3 });
      let settled = false;
      void pendingPublish.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(settled).toBe(false);

      releaseLock();
      await holder;
      expect((await pendingPublish).statusCode).toBe(201);
      expect(await db.prisma.journeyVersion.count({ where: { journeyId: id } })).toBe(1);

      // 新依据并发发布：一个请求创建版本，另一个命中已有版本，不会生成第二份。
      expect(
        (await saveDraft(app, cookie, id, revision, draftWithBody('并发版本'))).statusCode,
      ).toBe(200);
      const [first, second] = await Promise.all([
        publish(app, cookie, id, { revision: 3, segmentRevision: 3 }),
        publish(app, cookie, id, { revision: 3, segmentRevision: 3 }),
      ]);
      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 201]);
      expect(first.json().data.id).toBe(second.json().data.id);
      expect(await db.prisma.journeyVersion.count({ where: { journeyId: id } })).toBe(2);
    } finally {
      await app.close();
    }
  });
});

const evaluatedAt = testNow.toISOString();

const conditionOutput = (branch: 'met' | 'unmet') => ({
  kind: 'condition',
  rule: { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gte', right: 18 },
  matched: branch === 'met',
  branch,
  evidence: { kind: 'value', evaluatedAt, actual: { exists: true, value: 30 } },
});

const waitOutput = { kind: 'wait', waitSeconds: 5 };

const waitForEventOutput = (outcome: 'matched' | 'timeout') => ({
  kind: 'wait_for_event',
  eventType: 'purchase_completed',
  waitSeconds: 60,
  sameProduct: true,
  outcome,
  matchedEventId: outcome === 'matched' ? randomUUID() : null,
});

const startOutput = { kind: 'start', entryBehavior: 'product_viewed' };
const endOutput = { kind: 'end', note: null };
const failedOutput = { kind: 'failed', reason: '判断用户资料失败' };

function messageOutput(audienceUserId: string, body: string) {
  return {
    kind: 'message',
    channel: 'sms',
    subject: null,
    body,
    audienceUserId,
    demo: true,
  };
}

interface SeedStep {
  nodeId: string;
  nodeType: JourneyNodeType;
  status: ExecutionStepStatus;
  output: unknown;
}

/** 受控数据：直接写入一次执行及其步骤，用于核对统计的计数关系。 */
async function seedExecution(options: {
  journey: TestJourney;
  audienceUserId: string;
  status: ExecutionStatus;
  steps: SeedStep[];
}): Promise<void> {
  const eventId = randomUUID();
  await db.prisma.event.create({
    data: {
      id: eventId,
      audienceUserId: options.audienceUserId,
      type: 'product_viewed',
      payload: { productId: 'product-1', price: 299 },
      audienceSnapshot: {},
      receivedAt: testNow,
    },
  });
  const execution = await db.prisma.execution.create({
    data: {
      campaignId: options.journey.campaignId,
      journeyId: options.journey.journeyId,
      journeyVersionId: options.journey.versionId,
      audienceUserId: options.audienceUserId,
      triggerEventId: eventId,
      status: options.status,
      startedAt: testNow,
      ...(options.status === 'waiting' ? { currentNodeId: 'wait' } : {}),
    },
    select: { id: true },
  });

  for (const [index, step] of options.steps.entries()) {
    await db.prisma.executionStep.create({
      data: {
        executionId: execution.id,
        order: index + 1,
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        status: step.status,
        output: step.output as Prisma.InputJsonValue,
        startedAt: testNow,
        ...(step.status === 'succeeded' ? { endedAt: testNow } : {}),
      },
    });
  }
}

function getStats(app: TestApp, cookie: string, id: string, versionId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/journeys/${id}/versions/${versionId}/stats`,
    headers: { cookie },
  });
}

describe('旅程版本运行统计', () => {
  it('统计要求登录，旅程不存在与跨旅程版本都按版本不存在处理，无效链接明确报错', async () => {
    const { app } = makeApp(db);
    try {
      const journey = await publishTestJourney(db, {
        name: '统计鉴权',
        definition: minimalDefinition(),
      });
      const other = await publishTestJourney(db, {
        name: '统计鉴权另一条',
        definition: minimalDefinition(),
      });

      const anonymous = await app.inject({
        method: 'GET',
        url: `/api/journeys/${journey.journeyId}/versions/${journey.versionId}/stats`,
      });
      expect(anonymous.statusCode).toBe(401);

      const cookie = await signedInCookie(app);
      // 与版本详情一致：按“旅程 + 版本”一起查找，旅程不存在时不额外区分。
      const missingJourney = await getStats(app, cookie, missingId, journey.versionId);
      expect(missingJourney.statusCode).toBe(404);
      expect(missingJourney.json().error.message).toBe('版本不存在');

      const crossed = await getStats(app, cookie, journey.journeyId, other.versionId);
      expect(crossed.statusCode).toBe(404);
      expect(crossed.json().error.message).toBe('版本不存在');

      const invalid = await getStats(app, cookie, 'not-a-uuid', journey.versionId);
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.message).toBe('版本链接无效');
    } finally {
      await app.close();
    }
  });

  it('按执行记录给出状态分布与去重人数，按步骤记录给出节点与分支计数', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const journey = await publishTestJourney(db, {
        name: '统计计数',
        definition: fullDefinition(),
      });
      const firstUser = await createAudienceUser(db, {
        externalId: 'stats:user:one',
        displayName: '统计用户一',
      });
      const secondUser = await createAudienceUser(db, {
        externalId: 'stats:user:two',
        displayName: '统计用户二',
      });

      const start: SeedStep = {
        nodeId: 'start',
        nodeType: 'start',
        status: 'succeeded',
        output: startOutput,
      };
      const conditionMet: SeedStep = {
        nodeId: 'condition',
        nodeType: 'condition',
        status: 'succeeded',
        output: conditionOutput('met'),
      };
      const wait: SeedStep = {
        nodeId: 'wait',
        nodeType: 'wait',
        status: 'succeeded',
        output: waitOutput,
      };

      // 执行一：满足条件、等到行为、走完全程。
      await seedExecution({
        journey,
        audienceUserId: firstUser,
        status: 'completed',
        steps: [
          start,
          conditionMet,
          wait,
          {
            nodeId: 'wait-event',
            nodeType: 'wait_for_event',
            status: 'succeeded',
            output: waitForEventOutput('matched'),
          },
          {
            nodeId: 'message-matched',
            nodeType: 'message',
            status: 'succeeded',
            output: messageOutput(firstUser, '感谢购买'),
          },
          { nodeId: 'end-matched', nodeType: 'end', status: 'succeeded', output: endOutput },
        ],
      });
      // 执行二：同一用户，等待行为超时。
      await seedExecution({
        journey,
        audienceUserId: firstUser,
        status: 'completed',
        steps: [
          start,
          conditionMet,
          wait,
          {
            nodeId: 'wait-event',
            nodeType: 'wait_for_event',
            status: 'succeeded',
            output: waitForEventOutput('timeout'),
          },
          {
            nodeId: 'message-timeout',
            nodeType: 'message',
            status: 'succeeded',
            output: messageOutput(firstUser, '购买提醒'),
          },
          { nodeId: 'end-timeout', nodeType: 'end', status: 'succeeded', output: endOutput },
        ],
      });
      // 执行三：另一名用户，条件不满足。
      await seedExecution({
        journey,
        audienceUserId: secondUser,
        status: 'completed',
        steps: [
          start,
          {
            nodeId: 'condition',
            nodeType: 'condition',
            status: 'succeeded',
            output: conditionOutput('unmet'),
          },
          {
            nodeId: 'message-unmet',
            nodeType: 'message',
            status: 'succeeded',
            output: messageOutput(secondUser, '价格较低'),
          },
          { nodeId: 'end-unmet', nodeType: 'end', status: 'succeeded', output: endOutput },
        ],
      });
      // 执行四：停在定时等待上。
      await seedExecution({
        journey,
        audienceUserId: secondUser,
        status: 'waiting',
        steps: [
          start,
          conditionMet,
          { nodeId: 'wait', nodeType: 'wait', status: 'waiting', output: waitOutput },
        ],
      });
      // 执行五：条件判断失败。
      await seedExecution({
        journey,
        audienceUserId: firstUser,
        status: 'failed',
        steps: [
          start,
          {
            nodeId: 'condition',
            nodeType: 'condition',
            status: 'failed',
            output: failedOutput,
          },
        ],
      });
      // 执行六：开始后即停止。
      await seedExecution({
        journey,
        audienceUserId: secondUser,
        status: 'stopped',
        steps: [{ nodeId: 'start', nodeType: 'start', status: 'stopped', output: startOutput }],
      });

      const response = await getStats(app, cookie, journey.journeyId, journey.versionId);
      expect(response.statusCode).toBe(200);
      // 用共享契约解析响应，多字段或少字段都会失败。
      const { data } = journeyVersionStatsResponseSchema.parse(response.json());

      expect(data.executionCount).toBe(6);
      expect(data.audienceCount).toBe(2);
      expect(data.statusCounts).toEqual({
        running: 0,
        waiting: 1,
        completed: 3,
        failed: 1,
        stopped: 1,
      });

      const byNodeId = new Map(data.nodes.map((node) => [node.nodeId, node]));
      expect(byNodeId.size).toBe(10);
      expect(byNodeId.get('start')).toMatchObject({ entered: 6, completed: 5, stopped: 1 });
      expect(byNodeId.get('condition')).toMatchObject({
        entered: 5,
        completed: 4,
        failed: 1,
        conditionBranch: { met: 3, unmet: 1 },
        waitOutcome: null,
      });
      expect(byNodeId.get('wait')).toMatchObject({ entered: 3, completed: 2, waiting: 1 });
      expect(byNodeId.get('wait-event')).toMatchObject({
        entered: 2,
        completed: 2,
        conditionBranch: null,
        waitOutcome: { matched: 1, timeout: 1 },
      });
      for (const messageNodeId of ['message-matched', 'message-timeout', 'message-unmet']) {
        expect(byNodeId.get(messageNodeId)).toMatchObject({
          nodeType: 'message',
          entered: 1,
          completed: 1,
        });
      }

      // 三条基本关系：状态之和等于执行总数、各节点状态之和等于进入数、结束节点完成数之和等于已完成执行数。
      const { running, waiting, completed, failed, stopped } = data.statusCounts;
      expect(running + waiting + completed + failed + stopped).toBe(data.executionCount);
      for (const node of data.nodes) {
        expect(node.entered).toBe(node.completed + node.waiting + node.failed + node.stopped);
      }
      const endCompleted = data.nodes
        .filter((node) => node.nodeType === 'end')
        .reduce((sum, node) => sum + node.completed, 0);
      expect(endCompleted).toBe(completed);
    } finally {
      await app.close();
    }
  });

  it('同一旅程的两个版本互不串数，未到达的节点仍按本版快照列出全 0 行', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const journey = await publishTestJourney(db, {
        name: '统计版本隔离',
        definition: fullDefinition(),
      });
      const secondVersionId = await addTestVersion(db, journey.journeyId, {
        versionNumber: 2,
        name: '统计版本隔离',
        definition: minimalDefinition(),
      });
      const audienceUserId = await createAudienceUser(db, {
        externalId: 'stats:user:isolation',
        displayName: '统计用户三',
      });

      await seedExecution({
        journey,
        audienceUserId,
        status: 'completed',
        steps: [
          { nodeId: 'start', nodeType: 'start', status: 'succeeded', output: startOutput },
          {
            nodeId: 'condition',
            nodeType: 'condition',
            status: 'succeeded',
            output: conditionOutput('unmet'),
          },
          { nodeId: 'end-unmet', nodeType: 'end', status: 'succeeded', output: endOutput },
        ],
      });

      const first = await getStats(app, cookie, journey.journeyId, journey.versionId);
      expect(first.statusCode).toBe(200);
      expect(first.json().data.executionCount).toBe(1);
      expect(first.json().data.statusCounts.completed).toBe(1);

      const second = await getStats(app, cookie, journey.journeyId, secondVersionId);
      expect(second.statusCode).toBe(200);
      const { data } = journeyVersionStatsResponseSchema.parse(second.json());
      expect(data.executionCount).toBe(0);
      expect(data.audienceCount).toBe(0);
      expect(data.statusCounts).toEqual({
        running: 0,
        waiting: 0,
        completed: 0,
        failed: 0,
        stopped: 0,
      });
      // 第二版只有开始和结束两个节点，没有执行记录时按快照顺序给出全 0 行。
      expect(data.nodes).toEqual([
        {
          nodeId: 'start',
          name: '开始',
          nodeType: 'start',
          entered: 0,
          completed: 0,
          waiting: 0,
          failed: 0,
          stopped: 0,
          conditionBranch: null,
          waitOutcome: null,
        },
        {
          nodeId: 'end',
          name: '结束',
          nodeType: 'end',
          entered: 0,
          completed: 0,
          waiting: 0,
          failed: 0,
          stopped: 0,
          conditionBranch: null,
          waitOutcome: null,
        },
      ]);
    } finally {
      await app.close();
    }
  });
});

describe('消息变量的保存与发布边界', () => {
  it('语法错误阻止保存，商品来源问题允许保存但阻止发布', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      await seedCampaign();
      const created = await createJourney(app, cookie, { name: '消息变量旅程', segmentId: null });
      expect(created.statusCode).toBe(201);
      const id = created.json().data.id as string;

      const invalid = await saveDraft(app, cookie, id, 1, draftWithBody('您好 {{游客昵称}}'));
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error).toMatchObject({
        code: 'JOURNEY_DRAFT_INVALID',
        message: '消息内容中有不支持的变量，请从“插入变量”中选择',
      });

      const saved = await saveDraft(app, cookie, id, 1, draftWithBody('您好 {{商品名称}}'));
      expect(saved.statusCode).toBe(200);
      expect(saved.json().data.revision).toBe(2);

      const blocked = await publish(app, cookie, id, { revision: 2, segmentRevision: null });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toMatchObject({
        code: 'JOURNEY_DRAFT_INCOMPLETE',
        message:
          '「发送邮件」使用了商品名称，但当前进入行为没有商品信息。请更换进入行为，或删除商品变量。',
      });

      const productDraft = draftWithBody('您好 {{商品名称}}');
      const resaved = await saveDraft(app, cookie, id, 2, {
        ...productDraft,
        nodes: productDraft.nodes.map((node) =>
          node.id === 'n-start' ? { ...node, entryBehavior: 'product_viewed' as const } : node,
        ),
      });
      expect(resaved.statusCode).toBe(200);
      const published = await publish(app, cookie, id, { revision: 3, segmentRevision: null });
      expect(published.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });
});
