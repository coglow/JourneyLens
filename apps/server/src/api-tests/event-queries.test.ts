import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { advanceExecution } from '../modules/executions/runner.js';
import { jsonHeaders, makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';
import { startTestDatabase, type TestDatabase } from '../test-support/test-database.js';
import {
  createAudienceUser,
  fullDefinition,
  minimalDefinition,
  publishTestJourney,
} from '../test-support/execution-fixtures.js';

let db: TestDatabase;
let app: TestApp;
let cookie: string;
let clock: Date;

const audienceExternalId = 'upstream:demo:event-queries';
const eventId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';
const t0 = new Date('2026-07-30T08:00:00.000Z');

function requestHeaders() {
  return jsonHeaders(cookie);
}

async function ingest(input: {
  id?: string;
  type?: 'product_viewed' | 'purchase_completed' | 'app_session_started';
  payload?: Record<string, unknown>;
}) {
  return app.inject({
    method: 'POST',
    url: '/api/events/ingest',
    headers: requestHeaders(),
    payload: {
      id: input.id ?? randomUUID(),
      audienceExternalId,
      type: input.type ?? 'product_viewed',
      payload:
        input.payload ??
        (input.type === 'app_session_started'
          ? { sessionId: randomUUID() }
          : { productId: 'product-1', productName: '演示商品', price: 299 }),
    },
  });
}

async function list(url = '/api/events') {
  return app.inject({ method: 'GET', url, headers: requestHeaders() });
}

beforeAll(async () => {
  db = await startTestDatabase();
  clock = t0;
  ({ app } = makeApp(db, false, () => clock));
  cookie = await signedInCookie(app);
});

beforeEach(() => {
  clock = t0;
});

afterEach(async () => {
  await db.reset();
  cookie = await signedInCookie(app);
});

afterAll(async () => {
  if (app !== undefined) await app.close();
  if (db !== undefined) await db.close();
});

describe('已接收行为查询', () => {
  it('查询已保存行为、当前用户资料、内容及组合筛选', async () => {
    await createAudienceUser(db, {
      externalId: audienceExternalId,
      displayName: '林小北',
      email: 'private@example.com',
      attributes: { vipLevel: 'gold' },
    });
    expect((await ingest({ id: eventId })).statusCode).toBe(201);
    const other = await ingest({
      type: 'app_session_started',
      payload: { sessionId: 'session-2' },
    });
    expect(other.statusCode).toBe(201);

    const response = await list(
      `/api/events?q=${encodeURIComponent('林小北')}&type=product_viewed&eventId=${eventId}&receivedFrom=${encodeURIComponent(t0.toISOString())}&receivedTo=${encodeURIComponent(t0.toISOString())}`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: [
        {
          id: eventId,
          type: 'product_viewed',
          receivedAt: t0.toISOString(),
          audience: { displayName: '林小北', externalId: audienceExternalId },
        },
      ],
      page: { page: 1, pageSize: 10, total: 1 },
    });
    expect(response.json().data[0]).not.toHaveProperty('triggeredExecutionCount');
    expect(response.json().data[0]).not.toHaveProperty('matchedExecutionCount');

    const detail = await list(`/api/events/${eventId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({
      id: eventId,
      payload: { productId: 'product-1', productName: '演示商品', price: 299 },
      audience: { displayName: '林小北', externalId: audienceExternalId },
    });
    expect(detail.json().data.audienceSnapshot).toBeUndefined();
    expect(detail.json().data.audience.email).toBeUndefined();
  });

  it('统一分页保留进入与结束等待两类事实及同旅程的多次参与', async () => {
    await createAudienceUser(db, { externalId: audienceExternalId, displayName: '林小北' });
    const waitingJourney = await publishTestJourney(db, {
      name: '浏览后购买',
      definition: fullDefinition(),
    });
    await publishTestJourney(db, {
      name: '购买后结束',
      definition: minimalDefinition('purchase_completed'),
    });

    const waitingExecutionIds: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      // 最后两次参与使用相同进入时间，验证唯一ID能稳定决定先后顺序。
      const second = index < 9 ? index + 1 : 10;
      clock = new Date(t0.getTime() + second * 1_000);
      const browseEventId = index === 0 ? eventId : randomUUID();
      const browse = await ingest({ id: browseEventId });
      expect(browse.statusCode).toBe(201);
      const waitingExecutionId = browse.json().data.executions[0]!.id as string;
      waitingExecutionIds.push(waitingExecutionId);
      expect(await advanceExecution(db.prisma, waitingExecutionId, () => clock)).toBe('waiting');
    }

    // 当前草稿改名后，关联查询仍应读取执行固定版本中的名称。
    const draft = fullDefinition();
    const waitingNode = draft.nodes.find((node) => node.id === 'wait-event');
    if (waitingNode?.type === 'wait_for_event') waitingNode.name = '草稿里的等待购买';
    await db.prisma.journey.update({
      where: { id: waitingJourney.journeyId },
      data: { draftDefinition: draft as unknown as Prisma.InputJsonValue },
    });

    // 等待购买之前还有 5 秒定时等待，上面只推进到定时等待。先越过它让等待步骤真正开始计时，
    // 等待事件的命中窗口从步骤开始时刻算起，早于该时刻的行为不会命中。
    clock = new Date(t0.getTime() + 16_000);
    for (const waitingExecutionId of waitingExecutionIds) {
      expect(await advanceExecution(db.prisma, waitingExecutionId, () => clock)).toBe('waiting');
    }

    clock = new Date(t0.getTime() + 20_000);
    const purchase = await ingest({
      type: 'purchase_completed',
      payload: { orderId: 'order-1', productId: 'product-1', amount: 299 },
    });
    expect(purchase.statusCode).toBe(201);
    clock = new Date(t0.getTime() + 21_000);
    for (const waitingExecutionId of waitingExecutionIds) {
      expect(await advanceExecution(db.prisma, waitingExecutionId, () => clock)).toBe('completed');
    }
    const purchaseEventId = purchase.json().data.event.id as string;
    const purchaseExecutionId = purchase.json().data.executions[0]!.id as string;

    const firstPage = await list(`/api/events/${purchaseEventId}/executions?pageSize=10`);
    const secondPage = await list(`/api/events/${purchaseEventId}/executions?page=2&pageSize=10`);
    expect(firstPage.statusCode).toBe(200);
    expect(secondPage.statusCode).toBe(200);
    expect(firstPage.json().page).toEqual({ page: 1, pageSize: 10, total: 12 });
    expect(secondPage.json().page).toEqual({ page: 2, pageSize: 10, total: 12 });
    expect(firstPage.json().data[0]).toMatchObject({
      id: purchaseExecutionId,
      startedAt: new Date(t0.getTime() + 20_000).toISOString(),
      enteredByEvent: true,
      matchedStep: null,
    });

    const records = [...firstPage.json().data, ...secondPage.json().data];
    expect(records).toHaveLength(12);
    expect(new Set(records.map((record: { id: string }) => record.id)).size).toBe(12);
    expect(
      records.filter(
        (record: { enteredByEvent: boolean; journey: { id: string } }) =>
          !record.enteredByEvent && record.journey.id === waitingJourney.journeyId,
      ),
    ).toHaveLength(11);

    const sortedIds = [...records]
      .sort((left: { startedAt: string; id: string }, right: { startedAt: string; id: string }) => {
        if (left.startedAt !== right.startedAt) return left.startedAt < right.startedAt ? 1 : -1;
        return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
      })
      .map((record: { id: string }) => record.id);
    expect(records.map((record: { id: string }) => record.id)).toEqual(sortedIds);
    for (const record of records.filter(
      (row: { enteredByEvent: boolean }) => !row.enteredByEvent,
    )) {
      expect(record).toMatchObject({
        version: { id: waitingJourney.versionId, versionNumber: 1 },
        matchedStep: {
          nodeId: 'wait-event',
          nodeName: '等待购买',
          endedWaitingAt: new Date(t0.getTime() + 21_000).toISOString(),
        },
      });
    }
  });

  it('区分不存在与空关联，并明确拒绝非法筛选、分页和未登录请求', async () => {
    await createAudienceUser(db, { externalId: audienceExternalId, displayName: '林小北' });
    await ingest({ id: eventId });

    expect((await list('/api/events?pageSize=25')).statusCode).toBe(400);
    expect((await list('/api/events?receivedFrom=bad-time')).json().error.message).toContain(
      '接收时间范围无效',
    );
    expect((await list(`/api/events/${randomUUID()}`)).json().error.message).toBe('行为记录不存在');
    expect((await list(`/api/events/${randomUUID()}/executions`)).json().error.message).toBe(
      '行为记录不存在',
    );
    expect((await list(`/api/events/${eventId}/executions?relation=matched`)).statusCode).toBe(400);
    expect((await list(`/api/events/${eventId}/executions`)).json()).toMatchObject({
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });

    const unauthenticated = await app.inject({ method: 'GET', url: '/api/events' });
    expect(unauthenticated.statusCode).toBe(401);
  });
});
