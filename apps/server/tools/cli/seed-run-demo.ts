import type { Prisma } from '@prisma/client';
import {
  journeyDraftDefinitionSchema,
  journeyVersionSnapshotSchema,
  type JourneyDraftDefinition,
  type SegmentRule,
} from '@journeylens/shared';
import { createPrismaClient } from '../../src/db/client.js';

export const DEMO_CAMPAIGN_NAME = '[演示] 浏览挽回活动';
export const DEMO_SEGMENT_NAME = '[演示] 高价值会员';
export const DEMO_JOURNEY_NAME = '[演示] 浏览后购买挽回';
export const DEMO_AUDIENCE_EXTERNAL_IDS = [
  'upstream:demo:eligible',
  'upstream:demo:ineligible',
] as const;

const DEMO_DEFINITION: JourneyDraftDefinition = {
  layoutDirection: 'vertical',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: '用户浏览商品',
      position: { x: 0, y: 0 },
      entryBehavior: 'product_viewed',
    },
    {
      id: 'condition-price',
      type: 'condition',
      name: '商品价格判断',
      position: { x: 0, y: 140 },
      rules: {
        kind: 'compare',
        left: { source: 'entry_event', eventType: 'product_viewed', path: 'price' },
        operator: 'gte',
        right: 100,
      },
    },
    {
      id: 'wait-briefly',
      type: 'wait',
      name: '等待 5 秒',
      position: { x: 0, y: 280 },
      waitSeconds: 5,
    },
    {
      id: 'wait-purchase',
      type: 'wait_for_event',
      name: '等待同商品购买',
      position: { x: 0, y: 420 },
      eventType: 'purchase_completed',
      waitSeconds: 60,
      filter: { path: 'amount', operator: 'gte', right: 100 },
      sameProduct: true,
    },
    {
      id: 'message-thanks',
      type: 'message',
      name: '购买感谢消息',
      position: { x: -240, y: 560 },
      channel: 'sms',
      subject: null,
      body: '感谢购买，我们会尽快为你安排发货。',
    },
    {
      id: 'end-thanks',
      type: 'end',
      name: '购买分支结束',
      position: { x: -240, y: 700 },
      note: '用户在等待窗口内完成了同商品购买',
    },
    {
      id: 'message-reminder',
      type: 'message',
      name: '购买提醒消息',
      position: { x: 240, y: 560 },
      channel: 'push',
      subject: null,
      body: '你关注的商品还在等待，需要时可以继续完成购买。',
    },
    {
      id: 'end-reminder',
      type: 'end',
      name: '提醒分支结束',
      position: { x: 240, y: 700 },
      note: '等待超时，已执行演示提醒',
    },
    {
      id: 'message-low-price',
      type: 'message',
      name: '低价商品提示',
      position: { x: 0, y: 560 },
      channel: 'email',
      subject: '商品关注提醒',
      body: '这件商品价格较低，可以再比较一下其他选择。',
    },
    {
      id: 'end-low-price',
      type: 'end',
      name: '低价分支结束',
      position: { x: 0, y: 700 },
      note: '商品价格未达到演示门槛',
    },
  ],
  edges: [
    { id: 'edge-start-condition', source: 'start', target: 'condition-price' },
    {
      id: 'edge-condition-met',
      source: 'condition-price',
      target: 'wait-briefly',
      branch: 'met',
    },
    {
      id: 'edge-condition-unmet',
      source: 'condition-price',
      target: 'message-low-price',
      branch: 'unmet',
    },
    { id: 'edge-wait-purchase', source: 'wait-briefly', target: 'wait-purchase' },
    {
      id: 'edge-purchase-matched',
      source: 'wait-purchase',
      target: 'message-thanks',
      branch: 'matched',
    },
    {
      id: 'edge-purchase-timeout',
      source: 'wait-purchase',
      target: 'message-reminder',
      branch: 'timeout',
    },
    { id: 'edge-thanks-end', source: 'message-thanks', target: 'end-thanks' },
    { id: 'edge-reminder-end', source: 'message-reminder', target: 'end-reminder' },
    { id: 'edge-low-price-end', source: 'message-low-price', target: 'end-low-price' },
  ],
};

const DEMO_SEGMENT_RULES: SegmentRule = {
  kind: 'all',
  children: [
    {
      kind: 'compare',
      left: { source: 'user', path: 'vipLevel' },
      operator: 'in',
      right: ['gold', 'platinum'],
    },
  ],
};

async function seedRunDemo(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL 未设置，请检查根目录 .env');
  }

  // 样本在写入前先经过发布契约校验，避免初始化出一份运行时无法使用的流程。
  const definition = journeyDraftDefinitionSchema.parse(DEMO_DEFINITION);
  const prisma = createPrismaClient(databaseUrl);

  try {
    const operator = await prisma.operatorAccount.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, displayName: true },
    });
    if (operator === null) {
      throw new Error('还没有运营账号，请先运行 pnpm operator:create');
    }

    const users = await prisma.audienceUser.findMany({
      where: { externalId: { in: [...DEMO_AUDIENCE_EXTERNAL_IDS] } },
      select: { id: true, externalId: true },
    });
    if (users.length !== DEMO_AUDIENCE_EXTERNAL_IDS.length) {
      throw new Error(
        '演示用户尚未准备，请先通过 upstream:user 导入 upstream:demo:eligible 和 upstream:demo:ineligible 两名用户（用 --file 指定用户资料文件）',
      );
    }

    const created = await prisma.$transaction(
      async (tx) => {
        // 这些外部 ID 是专门的演示用户：清理它们的旧行为与运行历史，使重复初始化结果稳定。
        const audienceUserIds = users.map((user) => user.id);
        await tx.execution.deleteMany({ where: { audienceUserId: { in: audienceUserIds } } });
        await tx.event.deleteMany({ where: { audienceUserId: { in: audienceUserIds } } });

        const existingCampaign = await tx.campaign.findFirst({
          where: { name: DEMO_CAMPAIGN_NAME },
          select: { id: true },
        });
        if (existingCampaign !== null) {
          await tx.execution.deleteMany({ where: { campaignId: existingCampaign.id } });
          const journeys = await tx.journey.findMany({
            where: { campaignId: existingCampaign.id },
            select: { id: true },
          });
          const journeyIds = journeys.map((journey) => journey.id);
          if (journeyIds.length > 0) {
            // 发布版本表有不可修改触发器，开发样本重建时在事务内临时停用，删除后立即恢复。
            await tx.$executeRawUnsafe(
              'ALTER TABLE "journey_versions" DISABLE TRIGGER "journey_versions_immutable_trigger"',
            );
            await tx.journeyVersion.deleteMany({ where: { journeyId: { in: journeyIds } } });
            await tx.$executeRawUnsafe(
              'ALTER TABLE "journey_versions" ENABLE TRIGGER "journey_versions_immutable_trigger"',
            );
          }
          await tx.journey.deleteMany({ where: { campaignId: existingCampaign.id } });
          await tx.campaign.deleteMany({ where: { id: existingCampaign.id } });
        }
        await tx.segment.deleteMany({ where: { name: DEMO_SEGMENT_NAME } });

        const segment = await tx.segment.create({
          data: {
            name: DEMO_SEGMENT_NAME,
            description: '演示入口人群：黄金或铂金会员',
            rules: DEMO_SEGMENT_RULES as Prisma.InputJsonValue,
            createdById: operator.id,
            updatedById: operator.id,
          },
          select: { id: true },
        });
        const campaign = await tx.campaign.create({
          data: {
            name: DEMO_CAMPAIGN_NAME,
            description: '演示活动：收到商品浏览行为后运行已发布旅程',
            status: 'running',
            createdById: operator.id,
          },
          select: { id: true },
        });
        const journey = await tx.journey.create({
          data: {
            campaignId: campaign.id,
            segmentId: segment.id,
            name: DEMO_JOURNEY_NAME,
            description: '浏览商品后等待同商品购买；消息为演示发送。',
            draftDefinition: definition as Prisma.InputJsonValue,
            createdById: operator.id,
            updatedById: operator.id,
          },
          select: { id: true },
        });
        const snapshot = journeyVersionSnapshotSchema.parse({
          name: DEMO_JOURNEY_NAME,
          description: '浏览商品后等待同商品购买；消息为演示发送。',
          entrySegment: {
            id: segment.id,
            name: DEMO_SEGMENT_NAME,
            revision: 1,
            rules: DEMO_SEGMENT_RULES,
          },
          definition,
        });
        const version = await tx.journeyVersion.create({
          data: {
            journeyId: journey.id,
            versionNumber: 1,
            sourceRevision: 1,
            sourceSegmentRevision: 1,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            publishedById: operator.id,
            publishedAt: new Date(),
          },
          select: { id: true },
        });

        return {
          campaignId: campaign.id,
          journeyId: journey.id,
          versionId: version.id,
        };
      },
      { timeout: 30_000 },
    );

    console.log(`演示活动已就绪（进行中）：${DEMO_CAMPAIGN_NAME}`);
    console.log(`  活动：${created.campaignId}`);
    console.log(`  旅程：${created.journeyId}`);
    console.log(`  固定版本：${created.versionId}（第 1 版）`);
    console.log(`  入口分群：${DEMO_SEGMENT_NAME}（黄金或铂金会员）`);
    console.log(
      '  演示用户：upstream:demo:eligible（符合入口）、upstream:demo:ineligible（不符合入口）',
    );
    console.log('  已清理：以上两名演示用户的行为与运行历史，以及旧的演示活动/旅程/版本');
    console.log('发送行为时请运行 pnpm upstream:event，并通过 --file 指定实际的行为文件路径。');
  } finally {
    await prisma.$disconnect();
  }
}

seedRunDemo().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '未知错误';
  const safeMessage = message.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/gi, '[数据库连接串已隐藏]');
  console.error(`seed:run-demo 失败：${safeMessage}`);
  process.exitCode = 1;
});
