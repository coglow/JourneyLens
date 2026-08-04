import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  journeyDraftDefinitionSchema,
  journeyVersionSnapshotSchema,
  type JourneyDraftDefinition,
  type JourneyEventType,
  type SegmentRule,
} from '@journeylens/shared';
import { testAccountId, type TestDatabase } from './test-database.js';

export interface TestEntrySegment {
  name: string;
  rules: SegmentRule;
}

export interface TestJourneyOptions {
  name: string;
  definition: unknown;
  entrySegment?: TestEntrySegment | null;
  campaignStatus?: 'draft' | 'running' | 'paused' | 'stopped';
  publishedAt?: Date;
  campaignGoal?: { eventType: JourneyEventType; sameProduct?: boolean };
}

export interface TestJourney {
  campaignId: string;
  journeyId: string;
  versionId: string;
  segmentId: string | null;
}

export async function publishTestJourney(
  db: TestDatabase,
  options: TestJourneyOptions,
): Promise<TestJourney> {
  const prisma = db.prisma;
  const definition = journeyDraftDefinitionSchema.parse(options.definition);
  const segment =
    options.entrySegment === undefined || options.entrySegment === null
      ? null
      : await prisma.segment.create({
          data: {
            name: options.entrySegment.name,
            rules: options.entrySegment.rules as unknown as Prisma.InputJsonValue,
            createdById: testAccountId,
            updatedById: testAccountId,
          },
          select: { id: true, name: true },
        });
  const campaign = await prisma.campaign.create({
    data: {
      name: `测试活动 ${options.name}`,
      status: options.campaignStatus ?? 'running',
      ...(options.campaignGoal === undefined
        ? {}
        : {
            goalEventType: options.campaignGoal.eventType,
            goalSameProduct: options.campaignGoal.sameProduct ?? false,
          }),
      createdById: testAccountId,
    },
    select: { id: true },
  });
  const journey = await prisma.journey.create({
    data: {
      campaignId: campaign.id,
      ...(segment === null ? {} : { segmentId: segment.id }),
      name: options.name,
      draftDefinition: definition as Prisma.InputJsonValue,
      createdById: testAccountId,
      updatedById: testAccountId,
    },
    select: { id: true },
  });
  const snapshot = journeyVersionSnapshotSchema.parse({
    name: options.name,
    description: null,
    entrySegment:
      segment === null
        ? null
        : { id: segment.id, name: segment.name, revision: 1, rules: options.entrySegment!.rules },
    definition,
  });
  const version = await prisma.journeyVersion.create({
    data: {
      journeyId: journey.id,
      versionNumber: 1,
      sourceRevision: 1,
      sourceSegmentRevision: segment === null ? null : 1,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      publishedById: testAccountId,
      publishedAt: options.publishedAt ?? new Date('2026-07-16T08:00:00.000Z'),
    },
    select: { id: true },
  });

  return {
    campaignId: campaign.id,
    journeyId: journey.id,
    versionId: version.id,
    segmentId: segment?.id ?? null,
  };
}

/** 追加一个发布版本，用于验证新行为只选择版本号最大的版本。 */
export async function addTestVersion(
  db: TestDatabase,
  journeyId: string,
  options: {
    versionNumber: number;
    name: string;
    definition: unknown;
    entrySegment?: TestEntrySegment | null;
  },
): Promise<string> {
  const definition = journeyDraftDefinitionSchema.parse(options.definition);
  const snapshot = journeyVersionSnapshotSchema.parse({
    name: options.name,
    description: null,
    entrySegment:
      options.entrySegment === undefined || options.entrySegment === null
        ? null
        : {
            id: randomUUID(),
            name: options.entrySegment.name,
            revision: 1,
            rules: options.entrySegment.rules,
          },
    definition,
  });
  const version = await db.prisma.journeyVersion.create({
    data: {
      journeyId,
      versionNumber: options.versionNumber,
      sourceRevision: options.versionNumber,
      sourceSegmentRevision: null,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      publishedById: testAccountId,
      publishedAt: new Date('2026-07-16T08:00:00.000Z'),
    },
    select: { id: true },
  });
  return version.id;
}

export async function createAudienceUser(
  db: TestDatabase,
  input: {
    externalId: string;
    displayName: string;
    email?: string | null;
    attributes?: Record<string, unknown>;
  },
): Promise<string> {
  const user = await db.prisma.audienceUser.create({
    data: {
      id: randomUUID(),
      externalId: input.externalId,
      displayName: input.displayName,
      email: input.email ?? null,
      attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return user.id;
}

/** 最小可运行流程：开始 → 结束。 */
export function minimalDefinition(
  entryBehavior: string = 'product_viewed',
): JourneyDraftDefinition {
  return journeyDraftDefinitionSchema.parse({
    layoutDirection: 'vertical',
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: '开始',
        position: { x: 0, y: 0 },
        entryBehavior,
      },
      {
        id: 'end',
        type: 'end',
        name: '结束',
        position: { x: 0, y: 120 },
        note: '流程结束',
      },
    ],
    edges: [{ id: 'edge-1', source: 'start', target: 'end' }],
  });
}

/** 六类节点完整流程，包含条件、定时等待、行为等待及匹配/超时分支。 */
export function fullDefinition(
  options: {
    waitSeconds?: number;
    eventWaitSeconds?: number;
    sameProduct?: boolean;
  } = {},
): JourneyDraftDefinition {
  return journeyDraftDefinitionSchema.parse({
    layoutDirection: 'vertical',
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: '开始',
        position: { x: 0, y: 0 },
        entryBehavior: 'product_viewed',
      },
      {
        id: 'condition',
        type: 'condition',
        name: '价格判断',
        position: { x: 0, y: 100 },
        rules: {
          kind: 'compare',
          left: { source: 'entry_event', eventType: 'product_viewed', path: 'price' },
          operator: 'gte',
          right: 100,
        },
      },
      {
        id: 'wait',
        type: 'wait',
        name: '定时等待',
        position: { x: 0, y: 200 },
        waitSeconds: options.waitSeconds ?? 5,
      },
      {
        id: 'wait-event',
        type: 'wait_for_event',
        name: '等待购买',
        position: { x: 0, y: 300 },
        eventType: 'purchase_completed',
        waitSeconds: options.eventWaitSeconds ?? 60,
        sameProduct: options.sameProduct ?? true,
      },
      {
        id: 'message-matched',
        type: 'message',
        name: '购买感谢',
        position: { x: -200, y: 400 },
        channel: 'sms',
        subject: null,
        body: '感谢购买',
      },
      {
        id: 'end-matched',
        type: 'end',
        name: '匹配结束',
        position: { x: -200, y: 500 },
        note: '购买分支完成',
      },
      {
        id: 'message-timeout',
        type: 'message',
        name: '购买提醒',
        position: { x: 200, y: 400 },
        channel: 'push',
        subject: null,
        body: '购买提醒',
      },
      {
        id: 'end-timeout',
        type: 'end',
        name: '超时结束',
        position: { x: 200, y: 500 },
        note: '超时分支完成',
      },
      {
        id: 'message-unmet',
        type: 'message',
        name: '低价提示',
        position: { x: 0, y: 400 },
        channel: 'email',
        subject: '提醒',
        body: '价格较低',
      },
      {
        id: 'end-unmet',
        type: 'end',
        name: '低价结束',
        position: { x: 0, y: 500 },
        note: '价格未达到门槛',
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'condition' },
      { id: 'e2', source: 'condition', target: 'wait', branch: 'met' },
      { id: 'e3', source: 'condition', target: 'message-unmet', branch: 'unmet' },
      { id: 'e4', source: 'wait', target: 'wait-event' },
      { id: 'e5', source: 'wait-event', target: 'message-matched', branch: 'matched' },
      { id: 'e6', source: 'wait-event', target: 'message-timeout', branch: 'timeout' },
      { id: 'e7', source: 'message-matched', target: 'end-matched' },
      { id: 'e8', source: 'message-timeout', target: 'end-timeout' },
      { id: 'e9', source: 'message-unmet', target: 'end-unmet' },
    ],
  });
}
