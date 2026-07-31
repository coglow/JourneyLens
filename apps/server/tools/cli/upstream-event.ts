import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  JOURNEY_EVENT_TYPES,
  JOURNEY_EVENT_TYPE_LABELS,
  apiErrorResponseSchema,
  eventIngestResponseSchema,
  eventIngestSchema,
  executionTraceResponseSchema,
} from '@journeylens/shared';
import { readSecret, readText } from './prompt.js';

const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_WEB_URL = 'http://localhost:5173';

const sampleSchema = z
  .object({
    audienceExternalId: z
      .string({ error: '用户 ID 不能为空' })
      .trim()
      .min(1, '用户 ID 不能为空')
      .max(160, '用户 ID 最多 160 个字符'),
    events: z
      .array(
        z
          .object({
            // 省略 ID 时每次生成新行为；需要演示重试时在样本中固定同一个 ID。
            id: z.uuid().optional(),
            type: z.enum(JOURNEY_EVENT_TYPES, { error: '请选择有效的行为类型' }),
            payload: z.record(z.string(), z.json()).default({}),
            delaySeconds: z
              .number({ error: '发送前等待必须是整数秒' })
              .int('发送前等待必须是整数秒')
              .min(0, '发送前等待不能小于 0')
              .max(3600, '发送前等待最多 1 小时')
              .optional(),
          })
          .strict(),
      )
      .min(1, '样本至少包含一条行为'),
  })
  .strict();

async function readJsonResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(body);
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : `目标服务返回了无法处理的结果（${response.status}）`,
    );
  }
  return body;
}

async function readJourneyName(
  base: URL,
  cookie: string,
  executionId: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(new URL(`/api/executions/${executionId}/trace`, base), {
      method: 'GET',
      headers: { accept: 'application/json', cookie },
    });
    if (!response.ok) return undefined;
    const parsed = executionTraceResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.data.journey.name : undefined;
  } catch {
    return undefined;
  }
}

async function sendEvents(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: 'string' },
      'base-url': { type: 'string' },
      'web-url': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (typeof values.file !== 'string') {
    throw new Error('请提供 --file 指向行为样本文件');
  }

  const baseUrl = values['base-url'] ?? DEFAULT_BASE_URL;
  const base = new URL(baseUrl);
  const origin = base.origin;
  // 请求发往后端，详情链接使用前端地址；本地开发时二者使用不同端口。
  const webBase = new URL(values['web-url'] ?? DEFAULT_WEB_URL);
  const content = await readFile(values.file, 'utf8');
  const parsed = sampleSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    throw new Error(`行为样本无效：${parsed.error.issues[0]?.message ?? '请检查字段'}`);
  }

  // 发送前把所有行为按接收契约校验一遍，避免发送到一半才发现样本缺少必填标识。
  const planned = parsed.data.events.map((event) => ({
    delaySeconds: event.delaySeconds ?? 0,
    body: eventIngestSchema.parse({
      id: event.id ?? randomUUID(),
      audienceExternalId: parsed.data.audienceExternalId,
      type: event.type,
      payload: event.payload,
    }),
  }));

  const email = (await readText('运营账号邮箱: ')).trim();
  if (email === '') throw new Error('邮箱不能为空');
  const password = await readSecret('密码（输入不回显）: ');

  const headers = { 'content-type': 'application/json', origin, accept: 'application/json' };
  const loginResponse = await fetch(new URL('/api/auth/login', base), {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  });
  await readJsonResponse(loginResponse);
  const cookie = loginResponse.headers.getSetCookie()[0]?.split(';')[0];
  if (cookie === undefined || cookie === '') {
    throw new Error('登录成功但没有取得会话，请检查目标服务地址');
  }

  console.log(`目标服务：${origin}`);
  for (const [index, event] of planned.entries()) {
    if (event.delaySeconds > 0) {
      console.log(`等待 ${event.delaySeconds} 秒后发送第 ${index + 1} 条行为…`);
      await delay(event.delaySeconds * 1000);
    }

    const response = await fetch(new URL('/api/events/ingest', base), {
      method: 'POST',
      headers: { ...headers, cookie },
      body: JSON.stringify(event.body),
    });
    const parsedResponse = eventIngestResponseSchema.safeParse(await readJsonResponse(response));
    if (!parsedResponse.success) {
      throw new Error('目标服务返回的行为接收结果无法识别');
    }

    const result = parsedResponse.data.data;
    console.log(
      `[${index + 1}/${planned.length}] ${JOURNEY_EVENT_TYPE_LABELS[event.body.type]}：${
        result.duplicate ? '该 ID 已发送过，未重复创建执行' : '已接收'
      }`,
    );
    console.log(`  行为 ID：${result.event.id}`);
    if (result.executions.length === 0) {
      console.log('  没有旅程创建执行（不符合入口人群或活动不在进行中）');
    }
    for (const execution of result.executions) {
      const journeyName = await readJourneyName(base, cookie, execution.id);
      console.log(
        `  执行详情：${new URL(`/executions/${execution.id}`, webBase).href}${journeyName === undefined ? '' : `（旅程：${journeyName}）`}`,
      );
    }
  }
}

sendEvents().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '未知错误';
  const safeMessage = message.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/gi, '[数据库连接串已隐藏]');
  console.error(`upstream:event 失败：${safeMessage}`);
  process.exitCode = 1;
});
