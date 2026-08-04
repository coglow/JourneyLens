import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiDraftModelCall } from '../modules/journeys/ai-draft-model.js';
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

const campaignId = '00000000-0000-4000-8200-000000000011';
const pausedCampaignId = '00000000-0000-4000-8200-000000000012';
const runningCampaignId = '00000000-0000-4000-8200-000000000013';
const missingJourneyId = '00000000-0000-4000-8000-000000000099';

const aiDraftConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid',
  model: 'test-model',
};

// 模型输出不含坐标，坐标由服务端补齐、前端重新排版。
const readyOutput = JSON.stringify({
  status: 'ready',
  nodes: [
    { id: 'n1', type: 'start', name: '开始', entryBehavior: 'product_viewed' },
    {
      id: 'n2',
      type: 'message',
      name: '短信提醒',
      channel: 'sms',
      subject: null,
      body: '欢迎按需查看商品详情。',
    },
    { id: 'n3', type: 'end', name: '结束', note: null },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
  ],
});

const needsInputOutput = JSON.stringify({
  status: 'needs_input',
  questions: [{ type: 'text', label: '最长等待多久？请带上单位。' }],
});

async function seedJourney(status: 'draft' | 'paused' | 'running', id: string): Promise<string> {
  await db.prisma.campaign.create({
    data: {
      id,
      name: `活动 ${id}`,
      status,
      createdById: testAccountId,
      createdAt: testNow,
      updatedAt: testNow,
    },
  });
  const journey = await db.prisma.journey.create({
    data: {
      campaignId: id,
      name: '商品浏览提醒',
      createdById: testAccountId,
      updatedById: testAccountId,
    },
    select: { id: true },
  });
  return journey.id;
}

function aiApp(callModel: AiDraftModelCall): TestApp {
  return makeApp(db, false, () => testNow, { config: aiDraftConfig, callModel }).app;
}

function postAiDraft(app: TestApp, cookie: string, journeyId: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/journeys/${journeyId}/ai-draft`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify(payload),
  });
}

const initialRequest = {
  entryBehavior: 'product_viewed',
  description: ' 等待一小时内购买同一商品，超时生成一条短信提醒。 ',
};

describe('AI 起草接口', () => {
  it('校验诊断关联请求编号，界面与日志不泄露原始描述和消息正文', async () => {
    const journeyId = await seedJourney('draft', campaignId);
    const candidate = JSON.parse(readyOutput);
    candidate.nodes[1].body = '原始消息正文不进入日志';
    candidate.nodes.splice(1, 0, {
      id: 'category',
      type: 'condition',
      name: '数码商品',
      rules: {
        kind: 'compare',
        left: { source: 'entry_event', eventType: 'product_viewed', path: 'category' },
        operator: 'in',
        right: ['electronics'],
      },
    });
    candidate.edges[0].target = 'category';
    candidate.edges.push(
      { id: 'category-met', source: 'category', target: 'n2', branch: 'met' },
      { id: 'category-unmet', source: 'category', target: 'n3', branch: 'unmet' },
    );
    const lines: string[] = [];
    const { app } = makeApp(
      db,
      {
        stream: {
          write: (message) => {
            lines.push(message);
          },
        },
      },
      () => testNow,
      {
        config: aiDraftConfig,
        callModel: async () => JSON.stringify(candidate),
      },
    );
    try {
      const cookie = await signedInCookie(app);
      lines.length = 0;
      const response = await postAiDraft(app, cookie, journeyId, {
        entryBehavior: 'product_viewed',
        description: '原始运营描述不进入日志',
      });
      expect(response.statusCode).toBe(502);
      const requestId = response.json().error.requestId;
      const records = lines.map((line) => JSON.parse(line));
      expect(records).toContainEqual(
        expect.objectContaining({
          requestId,
          stage: 'draft',
          issues: [
            {
              path: ['nodes', 1, 'rules', 'right'],
              message: '行为属性只能填写单个比较值，不能填写多个值',
            },
          ],
        }),
      );
      expect(response.json().error).not.toHaveProperty('issues');
      const logged = lines.join('\n');
      for (const secret of [
        '原始消息正文不进入日志',
        '原始运营描述不进入日志',
        'test-key',
        cookie,
      ]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      await app.close();
    }
  });

  it('未登录时拒绝，且不调用模型', async () => {
    const journeyId = await seedJourney('draft', campaignId);
    const callModel = vi.fn(async () => needsInputOutput);
    const app = aiApp(callModel);
    try {
      const response = await postAiDraft(app, '', journeyId, initialRequest);

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
      expect(callModel).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('进入行为缺失或非法时直接拒绝，不消耗生成次数', async () => {
    const journeyId = await seedJourney('draft', campaignId);
    const callModel = vi.fn(async () => needsInputOutput);
    const app = aiApp(callModel);
    try {
      const cookie = await signedInCookie(app);
      const invalid = await postAiDraft(app, cookie, journeyId, {
        description: '等待一小时内购买同一商品',
      });

      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error).toMatchObject({
        code: 'BAD_REQUEST',
        message: '请选择有效的进入行为，并填写有效的旅程描述',
      });
      expect(callModel).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('旅程不存在时明确反馈', async () => {
    const callModel = vi.fn(async () => needsInputOutput);
    const app = aiApp(callModel);
    try {
      const cookie = await signedInCookie(app);
      const response = await postAiDraft(app, cookie, missingJourneyId, initialRequest);

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
      expect(callModel).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('活动已启动时不能起草', async () => {
    const journeyId = await seedJourney('running', runningCampaignId);
    const callModel = vi.fn(async () => needsInputOutput);
    const app = aiApp(callModel);
    try {
      const cookie = await signedInCookie(app);
      const response = await postAiDraft(app, cookie, journeyId, initialRequest);

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以起草旅程',
      });
      expect(callModel).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('草稿和暂停的活动都可以起草，补答完整进入模型上下文，生成不写草稿', async () => {
    const draftJourneyId = await seedJourney('draft', campaignId);
    const pausedJourneyId = await seedJourney('paused', pausedCampaignId);
    const callModel = vi.fn<AiDraftModelCall>(async () => readyOutput);
    const app = aiApp(callModel);
    try {
      const cookie = await signedInCookie(app);
      const response = await postAiDraft(app, cookie, draftJourneyId, {
        entryBehavior: 'product_viewed',
        description: '等待一小时内购买同一商品，超时生成一条短信提醒。',
        clarifications: [{ question: { type: 'text', label: '最长等待多久？' }, answer: '1 小时' }],
      });

      expect(response.statusCode).toBe(200);
      const result = response.json().data;
      expect(result.status).toBe('ready');
      expect(result.draftDefinition.nodes[0]).toMatchObject({
        type: 'start',
        name: '开始',
        entryBehavior: 'product_viewed',
        position: { x: 0, y: 0 },
      });
      expect(result.draftDefinition.edges).toHaveLength(2);

      expect(callModel).toHaveBeenCalledTimes(1);
      const [, messages] = callModel.mock.calls[0]!;
      const prompt = messages.map((message) => message.content).join('\n');
      expect(prompt).toContain('浏览商品');
      expect(prompt).toContain('等待一小时内购买同一商品');
      expect(prompt).toContain('最长等待多久？');
      expect(prompt).toContain('1 小时');

      const stored = await db.prisma.journey.findUnique({
        where: { id: draftJourneyId },
        select: { draftDefinition: true, revision: true },
      });
      expect(stored).toMatchObject({ draftDefinition: null, revision: 1 });

      const paused = await postAiDraft(app, cookie, pausedJourneyId, initialRequest);
      expect(paused.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('信息不足时返回待补充问题，候选开始行为不一致时按无效输出拒绝', async () => {
    const journeyId = await seedJourney('draft', campaignId);
    const mismatch = JSON.stringify({
      status: 'ready',
      nodes: [
        { id: 'n1', type: 'start', name: '开始', entryBehavior: 'registration_completed' },
        { id: 'n2', type: 'end', name: '结束', note: null },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    let reply = needsInputOutput;
    const callModel = vi.fn(async () => reply);
    const app = aiApp(callModel);
    try {
      const cookie = await signedInCookie(app);
      const needsInput = await postAiDraft(app, cookie, journeyId, initialRequest);
      expect(needsInput.statusCode).toBe(200);
      expect(needsInput.json().data).toEqual({
        status: 'needs_input',
        questions: [{ type: 'text', label: '最长等待多久？请带上单位。' }],
      });

      reply = mismatch;
      const invalid = await postAiDraft(app, cookie, journeyId, initialRequest);
      expect(invalid.statusCode).toBe(502);
      // 具体原因随错误一起返回，界面据此说明哪一步需要调整。
      expect(invalid.json().error).toMatchObject({
        code: 'AI_DRAFT_INVALID_OUTPUT',
        message: '本次方案未通过流程检查，请按提示调整描述后重新生成',
        details: ['「开始」：开始行为与本次选择不一致'],
      });
    } finally {
      await app.close();
    }
  });

  it('补答不符合题目要求时拒绝，不调用模型', async () => {
    const journeyId = await seedJourney('draft', campaignId);
    const callModel = vi.fn(async () => needsInputOutput);
    const app = aiApp(callModel);
    try {
      const cookie = await signedInCookie(app);
      const response = await postAiDraft(app, cookie, journeyId, {
        entryBehavior: 'product_viewed',
        description: '等待购买后提醒',
        clarifications: [
          {
            question: {
              type: 'single_choice',
              label: '使用哪种提醒方式？',
              options: [
                { value: 'sms', label: '短信' },
                { value: 'email', label: '邮件' },
              ],
            },
            answer: 'push',
          },
        ],
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatchObject({
        code: 'BAD_REQUEST',
        message: '请填写完整的补充信息，并检查所选内容',
      });
      expect(callModel).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('同一账号 15 分钟内第 11 次生成被拒绝', async () => {
    const journeyId = await seedJourney('draft', campaignId);
    const callModel = vi.fn(async () => needsInputOutput);
    const app = aiApp(callModel);
    try {
      const cookie = await signedInCookie(app);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await postAiDraft(app, cookie, journeyId, initialRequest);
        expect(response.statusCode).toBe(200);
      }

      const limited = await postAiDraft(app, cookie, journeyId, initialRequest);
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error).toMatchObject({
        code: 'AI_DRAFT_RATE_LIMITED',
        message: '起草请求过于频繁，请稍后再试',
      });
      // 固定测试时钟下窗口不会过期，仍应给出等待秒数。
      expect(limited.headers['retry-after']).toBe('900');
      expect(callModel).toHaveBeenCalledTimes(10);
    } finally {
      await app.close();
    }
  });

  it('同账号同时只允许一个在途生成，结束后释放', async () => {
    const journeyId = await seedJourney('draft', campaignId);
    let release: ((value: string) => void) | undefined;
    let firstCall = true;
    const callModel: AiDraftModelCall = vi.fn(async () => {
      if (!firstCall) return needsInputOutput;
      firstCall = false;
      return await new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const app = aiApp(callModel);
    try {
      const cookie = await signedInCookie(app);
      const first = postAiDraft(app, cookie, journeyId, initialRequest);
      await vi.waitFor(() => expect(callModel).toHaveBeenCalledTimes(1));

      const blocked = await postAiDraft(app, cookie, journeyId, initialRequest);
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.message).toBe('请求过于频繁，请 60 秒后重试');

      release?.(needsInputOutput);
      expect((await first).statusCode).toBe(200);

      const afterRelease = await postAiDraft(app, cookie, journeyId, initialRequest);
      expect(afterRelease.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
