import type { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.restoreAllMocks();
});

const missingId = '00000000-0000-4000-8000-000000000099';

const vipRule = {
  kind: 'compare',
  left: { source: 'user', path: 'vipLevel' },
  operator: 'in',
  right: ['gold', 'platinum'],
};

const blacklistExclusion = {
  kind: 'not',
  child: {
    kind: 'compare',
    left: { source: 'user', path: 'isBlacklisted' },
    operator: 'eq',
    right: true,
  },
};

const combinedRule = {
  kind: 'all',
  children: [vipRule, blacklistExclusion],
};

function nestedRule(depth: number): unknown {
  let node: unknown = {
    kind: 'compare',
    left: { source: 'user', path: 'age' },
    operator: 'gte',
    right: 18,
  };
  for (let level = 1; level < depth; level += 1) {
    node = { kind: 'all', children: [node] };
  }
  return node;
}

function createSegment(
  app: TestApp,
  cookie: string,
  payload: unknown,
  origin = 'http://localhost',
) {
  return app.inject({
    method: 'POST',
    url: '/api/segments',
    headers: { ...jsonHeaders(cookie), origin },
    payload: JSON.stringify(payload),
  });
}

function patchSegment(
  app: TestApp,
  cookie: string,
  id: string,
  payload: unknown,
  origin = 'http://localhost',
) {
  return app.inject({
    method: 'PATCH',
    url: `/api/segments/${id}`,
    headers: { ...jsonHeaders(cookie), origin },
    payload: JSON.stringify(payload),
  });
}

function deleteSegment(app: TestApp, cookie: string, id: string, origin = 'http://localhost') {
  return app.inject({
    method: 'DELETE',
    url: `/api/segments/${id}`,
    headers: { host: 'localhost', origin, cookie },
  });
}

function previewSegment(app: TestApp, cookie: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/segments/preview',
    headers: jsonHeaders(cookie),
    payload: JSON.stringify(payload),
  });
}

function refreshSegment(app: TestApp, cookie: string, segmentId: string, revision: number) {
  return previewSegment(app, cookie, { segmentId, revision });
}

async function seedSegments(count = 23): Promise<void> {
  await db.prisma.segment.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`,
      name: `Segment ${String(index + 1).padStart(2, '0')}`,
      description: null,
      rules: vipRule as unknown as Prisma.InputJsonValue,
      revision: 1,
      createdById: testAccountId,
      updatedById: testAccountId,
      createdAt: testNow,
      updatedAt: testNow,
    })),
  });
}

async function seedAudience(
  users: Array<{
    id: string;
    externalId: string;
    displayName: string;
    email: string | null;
    attributes: Record<string, unknown>;
  }>,
): Promise<void> {
  await db.prisma.audienceUser.createMany({
    data: users.map((user) => ({
      ...user,
      attributes: user.attributes as Prisma.InputJsonValue,
    })),
  });
}

describe('分群 API', () => {
  it('创建规范化分群并从列表和详情读取真实记录', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, {
        name: '  高价值会员  ',
        description: '  ',
        rules: combinedRule,
      });

      expect(created.statusCode).toBe(201);
      const id = created.json().data.id as string;
      expect(created.json().data).toMatchObject({
        name: '高价值会员',
        description: null,
        rules: combinedRule,
        revision: 1,
        createdBy: { id: testAccountId, displayName: '测试运营账号' },
        updatedBy: { id: testAccountId, displayName: '测试运营账号' },
      });

      const stored = await db.prisma.segment.findUnique({ where: { id } });
      expect(stored?.name).toBe('高价值会员');
      expect(stored?.description).toBeNull();
      expect(stored?.rules).toEqual(combinedRule);
      expect(stored?.revision).toBe(1);

      const listed = await app.inject({
        method: 'GET',
        url: '/api/segments',
        headers: { cookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toMatchObject({
        data: [{ id, name: '高价值会员', rules: combinedRule }],
        page: { page: 1, pageSize: 10, total: 1 },
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/segments/${id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual({ data: created.json().data });

      const invalidId = await app.inject({
        method: 'GET',
        url: '/api/segments/not-a-uuid',
        headers: { cookie },
      });
      expect(invalidId.statusCode).toBe(400);
      expect(invalidId.json().error.message).toBe('分群链接无效');

      const missing = await app.inject({
        method: 'GET',
        url: `/api/segments/${missingId}`,
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.message).toBe('分群不存在');
    } finally {
      await app.close();
    }
  });

  it('默认第 1 页、翻页和每页条数按约定工作，越界页码回到最后一页', async () => {
    await seedSegments();
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const names = (start: number, end: number) =>
        Array.from(
          { length: end - start + 1 },
          (_, index) => `Segment ${String(start + index).padStart(2, '0')}`,
        );

      const first = await app.inject({
        method: 'GET',
        url: '/api/segments',
        headers: { cookie },
      });
      expect(first.json().page).toEqual({ page: 1, pageSize: 10, total: 23 });
      expect(first.json().data.map((item: { name: string }) => item.name)).toEqual(names(1, 10));

      const second = await app.inject({
        method: 'GET',
        url: '/api/segments?page=2&pageSize=10',
        headers: { cookie },
      });
      expect(second.json().page).toEqual({ page: 2, pageSize: 10, total: 23 });
      expect(second.json().data.map((item: { name: string }) => item.name)).toEqual(names(11, 20));

      const fifty = await app.inject({
        method: 'GET',
        url: '/api/segments?page=1&pageSize=50',
        headers: { cookie },
      });
      expect(fifty.json().page).toEqual({ page: 1, pageSize: 50, total: 23 });
      expect(fifty.json().data).toHaveLength(23);

      const outOfRange = await app.inject({
        method: 'GET',
        url: '/api/segments?page=99&pageSize=10',
        headers: { cookie },
      });
      expect(outOfRange.json().page).toEqual({ page: 3, pageSize: 10, total: 23 });
      expect(outOfRange.json().data.map((item: { name: string }) => item.name)).toEqual(
        names(21, 23),
      );
    } finally {
      await app.close();
    }
  });

  it('搜索名称和说明时按字面包含匹配，百分号和下划线不是通配符', async () => {
    await db.prisma.segment.createMany({
      data: [
        {
          id: '00000000-0000-4000-8001-000000000101',
          name: '100% 高价值用户',
          description: null,
          rules: vipRule as unknown as Prisma.InputJsonValue,
          revision: 1,
          createdById: testAccountId,
          updatedById: testAccountId,
        },
        {
          id: '00000000-0000-4000-8001-000000000102',
          name: 'a_b 用户',
          description: '带说明的分群',
          rules: vipRule as unknown as Prisma.InputJsonValue,
          revision: 1,
          createdById: testAccountId,
          updatedById: testAccountId,
        },
        {
          id: '00000000-0000-4000-8001-000000000103',
          name: 'axb 用户',
          description: null,
          rules: vipRule as unknown as Prisma.InputJsonValue,
          revision: 1,
          createdById: testAccountId,
          updatedById: testAccountId,
        },
      ],
    });
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const percent = await app.inject({
        method: 'GET',
        url: '/api/segments?q=100%25',
        headers: { cookie },
      });
      expect(percent.json().page.total).toBe(1);
      expect(percent.json().data[0].name).toBe('100% 高价值用户');

      const underscore = await app.inject({
        method: 'GET',
        url: '/api/segments?q=a_b',
        headers: { cookie },
      });
      expect(underscore.json().page.total).toBe(1);
      expect(underscore.json().data[0].name).toBe('a_b 用户');

      const description = await app.inject({
        method: 'GET',
        url: '/api/segments?q=%E8%AF%B4%E6%98%8E',
        headers: { cookie },
      });
      expect(description.json().page.total).toBe(1);
      expect(description.json().data[0].name).toBe('a_b 用户');
    } finally {
      await app.close();
    }
  });

  it('拒绝非法页码和每页条数，并说明具体原因', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      for (const [query, message] of [
        ['?page=0', '页码必须是正整数'],
        ['?page=-1', '页码必须是正整数'],
        ['?page=1.5', '页码必须是正整数'],
        ['?page=abc', '页码必须是正整数'],
        ['?pageSize=5', '每页条数只能选择 10、20 或 50 条'],
        ['?pageSize=10.0', '每页条数只能选择 10、20 或 50 条'],
        ['?page=0&pageSize=5', '页码必须是正整数；每页条数只能选择 10、20 或 50 条'],
        [`?q=${'x'.repeat(101)}`, '搜索词最多 100 个字符'],
      ]) {
        const invalid = await app.inject({
          method: 'GET',
          url: `/api/segments${query}`,
          headers: { cookie },
        });
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json().error.message).toBe(message);
      }
    } finally {
      await app.close();
    }
  });

  it('没有数据时返回第一页空列表', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const empty = await app.inject({
        method: 'GET',
        url: '/api/segments?page=3&pageSize=10',
        headers: { cookie },
      });
      expect(empty.json()).toEqual({
        data: [],
        page: { page: 1, pageSize: 10, total: 0 },
      });
    } finally {
      await app.close();
    }
  });

  it('修改时按修订号条件更新并递增，冲突时要求重新读取', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, {
        name: '待修改分群',
        description: '原说明',
        rules: vipRule,
      });
      const id = created.json().data.id as string;

      const updated = await patchSegment(app, cookie, id, {
        revision: 1,
        name: '  修改后分群  ',
        description: '  ',
        rules: combinedRule,
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().data).toMatchObject({
        id,
        name: '修改后分群',
        description: null,
        rules: combinedRule,
        revision: 2,
      });

      const stored = await db.prisma.segment.findUnique({ where: { id } });
      expect(stored?.name).toBe('修改后分群');
      expect(stored?.revision).toBe(2);

      const stale = await patchSegment(app, cookie, id, {
        revision: 1,
        name: '过期修改',
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('SEGMENT_REVISION_CONFLICT');
      expect(stale.json().error.message).toBe('分群已被修改，请重新读取后再保存');
      expect((await db.prisma.segment.findUnique({ where: { id } }))?.name).toBe('修改后分群');

      const missing = await patchSegment(app, cookie, missingId, {
        revision: 1,
        name: '不存在',
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('创建和修改都拒绝同名分群，修改失败时不覆盖原记录', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      expect(
        (await createSegment(app, cookie, { name: '已有分群', rules: vipRule })).statusCode,
      ).toBe(201);

      const duplicate = await createSegment(app, cookie, {
        name: '  已有分群  ',
        rules: vipRule,
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().error.code).toBe('SEGMENT_NAME_TAKEN');
      expect(duplicate.json().error.message).toBe('分群名称已存在');

      const second = await createSegment(app, cookie, { name: '另一个分群', rules: vipRule });
      const secondId = second.json().data.id as string;
      const conflict = await patchSegment(app, cookie, secondId, {
        revision: 1,
        name: '已有分群',
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error.code).toBe('SEGMENT_NAME_TAKEN');

      const stored = await db.prisma.segment.findUnique({ where: { id: secondId } });
      expect(stored?.name).toBe('另一个分群');
      expect(stored?.revision).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('拒绝非法创建和修改内容，并返回可理解的原因', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      for (const payload of [
        { name: '', rules: vipRule },
        { name: '   ', rules: vipRule },
        { name: 'x'.repeat(161), rules: vipRule },
        { name: '有效名称', description: 'x'.repeat(2001), rules: vipRule },
        { name: '有效名称', rules: vipRule, extra: true },
        { name: '有效名称', rules: { kind: 'all', children: [] } },
        { name: '有效名称', rules: nestedRule(9) },
        { name: '有效名称', rules: { ...vipRule, operator: 'gt', right: 1 } },
      ]) {
        expect((await createSegment(app, cookie, payload)).statusCode).toBe(400);
      }
      expect(await db.prisma.segment.count()).toBe(0);

      const extra = await createSegment(app, cookie, {
        name: '有效名称',
        rules: vipRule,
        extra: true,
      });
      expect(extra.statusCode).toBe(400);
      expect(extra.json().error.message).toBe('请检查分群名称、说明和规则');

      const wrongType = await createSegment(app, cookie, { name: 123, rules: vipRule });
      expect(wrongType.statusCode).toBe(400);
      expect(wrongType.json().error.message).toBe('请检查分群名称、说明和规则');

      const created = await createSegment(app, cookie, { name: '合法分群', rules: vipRule });
      const id = created.json().data.id as string;
      for (const payload of [
        {},
        { revision: 1 },
        { revision: 0, name: '修改' },
        { revision: 1, name: '   ' },
        { revision: 1, rules: { kind: 'all', children: [] } },
        { revision: 1, rules: nestedRule(9) },
        { revision: 1, name: '修改', extra: true },
      ]) {
        expect((await patchSegment(app, cookie, id, payload)).statusCode).toBe(400);
      }

      const tooDeep = await patchSegment(app, cookie, id, {
        revision: 1,
        rules: nestedRule(9),
      });
      expect(tooDeep.json().error.message).toBe('请检查分群名称、说明、规则和修订号');
    } finally {
      await app.close();
    }
  });

  it('DELETE 成功返回 204，重复删除和不存在时如实反馈', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, { name: '待删除分群', rules: vipRule });
      const id = created.json().data.id as string;

      expect((await deleteSegment(app, cookie, id)).statusCode).toBe(204);
      expect(await db.prisma.segment.count({ where: { id } })).toBe(0);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/segments/${id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(404);

      const repeated = await deleteSegment(app, cookie, id);
      expect(repeated.statusCode).toBe(404);
      expect(repeated.json().error.message).toBe('分群不存在');

      expect((await deleteSegment(app, cookie, 'not-a-uuid')).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('引用列表返回旅程和所属活动，分群不存在时返回不存在', async () => {
    const campaignId = '00000000-0000-4000-8200-000000000501';
    await db.prisma.campaign.create({
      data: {
        id: campaignId,
        name: '引用活动',
        status: 'running',
        createdById: testAccountId,
      },
    });
    await seedSegments(1);
    const segmentId = '00000000-0000-4000-8001-000000000001';
    await db.prisma.journey.createMany({
      data: [
        {
          id: '00000000-0000-4000-8202-000000000501',
          campaignId,
          segmentId,
          name: '引用旅程一',
          createdById: testAccountId,
          updatedById: testAccountId,
          createdAt: testNow,
          updatedAt: new Date(testNow.getTime() + 1000),
        },
        {
          id: '00000000-0000-4000-8202-000000000502',
          campaignId,
          segmentId,
          name: '引用旅程二',
          createdById: testAccountId,
          updatedById: testAccountId,
          createdAt: testNow,
          updatedAt: new Date(testNow.getTime() + 2000),
        },
      ],
    });

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const usages = await app.inject({
        method: 'GET',
        url: `/api/segments/${segmentId}/usages`,
        headers: { cookie },
      });
      expect(usages.statusCode).toBe(200);
      expect(usages.json().page).toEqual({ page: 1, pageSize: 10, total: 2 });
      expect(usages.json().data).toEqual([
        {
          journey: { id: '00000000-0000-4000-8202-000000000502', name: '引用旅程二' },
          campaign: { id: campaignId, name: '引用活动', status: 'running' },
          updatedAt: new Date(testNow.getTime() + 2000).toISOString(),
        },
        {
          journey: { id: '00000000-0000-4000-8202-000000000501', name: '引用旅程一' },
          campaign: { id: campaignId, name: '引用活动', status: 'running' },
          updatedAt: new Date(testNow.getTime() + 1000).toISOString(),
        },
      ]);

      // 详情和列表都要给出引用数量，页面才能在确认删除前禁用按钮。
      const detail = await app.inject({
        method: 'GET',
        url: `/api/segments/${segmentId}`,
        headers: { cookie },
      });
      expect(detail.json().data.journeyCount).toBe(2);

      const listed = await app.inject({
        method: 'GET',
        url: '/api/segments',
        headers: { cookie },
      });
      expect(listed.json().data[0].journeyCount).toBe(2);

      const empty = await app.inject({
        method: 'GET',
        url: '/api/segments/00000000-0000-4000-8001-000000000099/usages',
        headers: { cookie },
      });
      expect(empty.statusCode).toBe(404);
      expect(empty.json().error.message).toBe('分群不存在');
    } finally {
      await app.close();
    }
  });

  it('被旅程引用时不能删除分群，解除引用后可以删除', async () => {
    await seedSegments(1);
    const segmentId = '00000000-0000-4000-8001-000000000001';
    const campaignId = '00000000-0000-4000-8200-000000000502';
    await db.prisma.campaign.create({
      data: { id: campaignId, name: '引用保护活动', createdById: testAccountId },
    });
    const journey = await db.prisma.journey.create({
      data: {
        campaignId,
        segmentId,
        name: '引用旅程',
        createdById: testAccountId,
        updatedById: testAccountId,
      },
    });

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const blocked = await deleteSegment(app, cookie, segmentId);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toMatchObject({
        code: 'SEGMENT_IN_USE',
        message: '分群正在被旅程使用，请先更换或解除关联',
      });
      expect(await db.prisma.segment.count({ where: { id: segmentId } })).toBe(1);
      expect(await db.prisma.journey.count({ where: { id: journey.id } })).toBe(1);

      await db.prisma.journey.update({ where: { id: journey.id }, data: { segmentId: null } });
      expect((await deleteSegment(app, cookie, segmentId)).statusCode).toBe(204);
      expect(await db.prisma.segment.count({ where: { id: segmentId } })).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('手动计算人数返回总数、命中数和计算时间，不写入业务数据也不泄露受众资料', async () => {
    await seedAudience([
      {
        id: '00000000-0000-4000-8000-000000000101',
        externalId: 'seed:demo:001',
        displayName: '黄金会员',
        email: 'gold@example.com',
        attributes: { vipLevel: 'gold', totalSpend: 5000, isBlacklisted: false },
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        externalId: 'seed:demo:002',
        displayName: '普通会员',
        email: null,
        attributes: { vipLevel: 'normal', totalSpend: 100, isBlacklisted: true },
      },
      {
        id: '00000000-0000-4000-8000-000000000103',
        externalId: 'seed:demo:003',
        displayName: '铂金会员',
        email: 'platinum@example.com',
        attributes: { vipLevel: 'platinum', totalSpend: 8000, isBlacklisted: false },
      },
    ]);
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const preview = await previewSegment(app, cookie, { rules: combinedRule });

      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toEqual({
        data: {
          total: 3,
          matched: 2,
          calculatedAt: testNow.toISOString(),
        },
      });
      expect(Object.keys(preview.json().data).sort()).toEqual(['calculatedAt', 'matched', 'total']);
      expect(await db.prisma.segment.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('已填写和未填写统一按 exists 判断，不区分字段存储位置', async () => {
    await seedAudience([
      {
        id: '00000000-0000-4000-8000-000000000201',
        externalId: 'seed:exists:001',
        displayName: '资料完整',
        email: 'full@example.com',
        attributes: { gender: 'female' },
      },
      {
        id: '00000000-0000-4000-8000-000000000202',
        externalId: 'seed:exists:002',
        displayName: '资料缺失',
        email: null,
        attributes: {},
      },
      {
        id: '00000000-0000-4000-8000-000000000203',
        externalId: 'seed:exists:003',
        displayName: '仅缺邮箱',
        email: null,
        attributes: { gender: 'male' },
      },
    ]);
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const notExists = (path: string) => ({
        kind: 'not',
        child: { kind: 'compare', left: { source: 'user', path }, operator: 'exists' },
      });
      const exists = (path: string) => ({
        kind: 'compare',
        left: { source: 'user', path },
        operator: 'exists',
      });

      const missingEmail = await previewSegment(app, cookie, { rules: notExists('email') });
      expect(missingEmail.statusCode).toBe(200);
      expect(missingEmail.json().data).toEqual({
        total: 3,
        matched: 2,
        calculatedAt: testNow.toISOString(),
      });

      const missingGender = await previewSegment(app, cookie, { rules: notExists('gender') });
      expect(missingGender.json().data).toMatchObject({ total: 3, matched: 1 });

      const filledGender = await previewSegment(app, cookie, { rules: exists('gender') });
      expect(filledGender.json().data).toMatchObject({ total: 3, matched: 2 });

      const nullRule = await previewSegment(app, cookie, {
        rules: {
          kind: 'compare',
          left: { source: 'user', path: 'email' },
          operator: 'eq',
          right: null,
        },
      });
      expect(nullRule.statusCode).toBe(400);
      expect(nullRule.json().error.message).toBe('请检查计算条件');
    } finally {
      await app.close();
    }
  });

  it('没有受众时如实返回零人，非法规则不发起计算', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const empty = await previewSegment(app, cookie, { rules: vipRule });
      expect(empty.statusCode).toBe(200);
      expect(empty.json().data).toEqual({
        total: 0,
        matched: 0,
        calculatedAt: testNow.toISOString(),
      });

      const invalid = await previewSegment(app, cookie, {
        rules: { kind: 'all', children: [] },
      });
      expect(invalid.statusCode).toBe(400);

      const extra = await previewSegment(app, cookie, { rules: vipRule, segmentId: missingId });
      expect(extra.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('受众超过 10,000 人时明确拒绝，不静默只算前一部分', async () => {
    const users = Array.from({ length: 10_001 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      externalId: `perf:${String(index)}`,
      displayName: `受众 ${String(index)}`,
      email: null,
      attributes: { vipLevel: 'normal' },
    }));
    await seedAudience(users);
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const tooLarge = await previewSegment(app, cookie, { rules: vipRule });
      expect(tooLarge.statusCode).toBe(422);
      expect(tooLarge.json().error.code).toBe('AUDIENCE_TOO_LARGE');
      expect(tooLarge.json().error.message).toBe('当前演示受众超过 10000 人，暂不支持计算');

      const created = await createSegment(app, cookie, { name: '超量分群', rules: vipRule });
      const id = created.json().data.id as string;
      const refresh = await refreshSegment(app, cookie, id, 1);
      expect(refresh.statusCode).toBe(422);
      expect(await db.prisma.segmentPreviewSnapshot.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('未登录访问分群接口返回 401', async () => {
    const { app } = makeApp(db);
    try {
      expect((await app.inject({ method: 'GET', url: '/api/segments' })).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'GET', url: `/api/segments/${missingId}` })).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/segments',
            headers: {
              host: 'localhost',
              origin: 'http://localhost',
              'content-type': 'application/json',
            },
            payload: { name: '未登录创建', rules: vipRule },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/segments/preview',
            headers: {
              host: 'localhost',
              origin: 'http://localhost',
              'content-type': 'application/json',
            },
            payload: { rules: vipRule },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/segments/${missingId}`,
            headers: { host: 'localhost', origin: 'http://localhost' },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('来自其他站点的写请求被拒绝', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, { name: '来源检查分群', rules: vipRule });
      const id = created.json().data.id as string;
      const elsewhere = 'https://elsewhere.example';

      expect(
        (await createSegment(app, cookie, { name: '跨来源创建', rules: vipRule }, elsewhere))
          .statusCode,
      ).toBe(403);
      expect(
        (await patchSegment(app, cookie, id, { revision: 1, name: '跨来源修改' }, elsewhere))
          .statusCode,
      ).toBe(403);
      expect((await deleteSegment(app, cookie, id, elsewhere)).statusCode).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/segments/preview',
            headers: { ...jsonHeaders(cookie), origin: elsewhere },
            payload: { rules: vipRule },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('数据库读取、写入和计算失败不伪装成成功', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      vi.spyOn(db.prisma.segment, 'findMany').mockRejectedValueOnce(
        new Error('database read failed'),
      );
      expect(
        (await app.inject({ method: 'GET', url: '/api/segments', headers: { cookie } })).statusCode,
      ).toBe(500);

      vi.spyOn(db.prisma.segment, 'create').mockRejectedValueOnce(
        new Error('database write failed'),
      );
      expect(
        (await createSegment(app, cookie, { name: '写入失败', rules: vipRule })).statusCode,
      ).toBe(500);

      vi.spyOn(db.prisma.segment, 'findUnique').mockRejectedValueOnce(
        new Error('database read failed'),
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/segments/${missingId}`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(500);

      vi.spyOn(db.prisma.audienceUser, 'findMany').mockRejectedValueOnce(
        new Error('database read failed'),
      );
      expect((await previewSegment(app, cookie, { rules: vipRule })).statusCode).toBe(500);

      const created = await createSegment(app, cookie, { name: '更新失败分群', rules: vipRule });
      const id = created.json().data.id as string;
      vi.spyOn(db.prisma.segment, 'updateMany').mockRejectedValueOnce(
        new Error('database write failed'),
      );
      expect(
        (await patchSegment(app, cookie, id, { revision: 1, name: '更新失败' })).statusCode,
      ).toBe(500);

      vi.spyOn(db.prisma.segment, 'deleteMany').mockRejectedValueOnce(
        new Error('database write failed'),
      );
      expect((await deleteSegment(app, cookie, id)).statusCode).toBe(500);

      const refreshTarget = await createSegment(app, cookie, {
        name: '人数保存失败分群',
        rules: vipRule,
      });
      const refreshId = refreshTarget.json().data.id as string;
      // 刷新人数在短事务里写最近结果；事务失败必须如实反馈，不能假装保存成功。
      vi.spyOn(db.prisma, '$transaction').mockRejectedValueOnce(new Error('database write failed'));
      expect((await refreshSegment(app, cookie, refreshId, 1)).statusCode).toBe(500);
      expect(
        await db.prisma.segmentPreviewSnapshot.count({ where: { segmentId: refreshId } }),
      ).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('创建和修改只拒绝整体不可能命中的规则，分支矛盾和零人规则仍可保存', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const impossible = {
        kind: 'all',
        children: [
          { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gt', right: 100 },
          { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'lt', right: 10 },
        ],
      };

      const blocked = await createSegment(app, cookie, { name: '矛盾分群', rules: impossible });
      expect(blocked.statusCode).toBe(400);
      expect(blocked.json().error).toMatchObject({ code: 'SEGMENT_RULE_UNSATISFIABLE' });
      expect(blocked.json().error.message).toContain('不能同时成立');
      expect(Object.keys(blocked.json().error).sort()).toEqual(['code', 'message', 'requestId']);
      expect(await db.prisma.segment.count()).toBe(0);

      const deadBranch = {
        kind: 'any',
        children: [
          impossible,
          { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gte', right: 18 },
        ],
      };
      const created = await createSegment(app, cookie, {
        name: '含矛盾分支分群',
        rules: deadBranch,
      });
      expect(created.statusCode).toBe(201);

      const zero = await createSegment(app, cookie, {
        name: '零人规则',
        rules: {
          kind: 'compare',
          left: { source: 'user', path: 'age' },
          operator: 'gt',
          right: 150,
        },
      });
      expect(zero.statusCode).toBe(201);

      const id = created.json().data.id as string;
      const patched = await patchSegment(app, cookie, id, { revision: 1, rules: impossible });
      expect(patched.statusCode).toBe(400);
      expect(patched.json().error.code).toBe('SEGMENT_RULE_UNSATISFIABLE');

      const stored = await db.prisma.segment.findUnique({ where: { id } });
      expect(stored?.rules).toEqual(deadBranch);
      expect(stored?.revision).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('数据库里已存在的矛盾规则仍可读取和删除', async () => {
    const id = '00000000-0000-4000-8001-000000000301';
    await db.prisma.segment.create({
      data: {
        id,
        name: '历史矛盾分群',
        rules: {
          kind: 'all',
          children: [
            { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gt', right: 100 },
            { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'lt', right: 10 },
          ],
        } as unknown as Prisma.InputJsonValue,
        revision: 1,
        createdById: testAccountId,
        updatedById: testAccountId,
      },
    });
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const detail = await app.inject({
        method: 'GET',
        url: `/api/segments/${id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.audienceEstimate).toBeNull();

      expect((await deleteSegment(app, cookie, id)).statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it('尚未计算时列表和详情返回空人数结果，规则试算不写库', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, { name: '未计算分群', rules: vipRule });
      const id = created.json().data.id as string;
      expect(created.json().data.audienceEstimate).toBeNull();

      const detail = await app.inject({
        method: 'GET',
        url: `/api/segments/${id}`,
        headers: { cookie },
      });
      expect(detail.json().data.audienceEstimate).toBeNull();

      const listed = await app.inject({
        method: 'GET',
        url: '/api/segments',
        headers: { cookie },
      });
      expect(listed.json().data[0].audienceEstimate).toBeNull();
      expect(Object.keys(listed.json().data[0]).sort()).toEqual([
        'audienceEstimate',
        'description',
        'id',
        'journeyCount',
        'name',
        'rules',
        'updatedAt',
      ]);

      const preview = await previewSegment(app, cookie, { rules: vipRule });
      expect(preview.statusCode).toBe(200);
      expect(Object.keys(preview.json().data).sort()).toEqual(['calculatedAt', 'matched', 'total']);
      expect(await db.prisma.segmentPreviewSnapshot.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('刷新已保存分群保存最近结果，修改后提示需重算，刷新人数不改变分群信息', async () => {
    await seedAudience([
      {
        id: '00000000-0000-4000-8000-000000000111',
        externalId: 'seed:snapshot:001',
        displayName: '黄金会员',
        email: 'gold@example.com',
        attributes: { vipLevel: 'gold', isBlacklisted: false },
      },
      {
        id: '00000000-0000-4000-8000-000000000112',
        externalId: 'seed:snapshot:002',
        displayName: '普通会员',
        email: null,
        attributes: { vipLevel: 'normal', isBlacklisted: true },
      },
      {
        id: '00000000-0000-4000-8000-000000000113',
        externalId: 'seed:snapshot:003',
        displayName: '铂金会员',
        email: 'platinum@example.com',
        attributes: { vipLevel: 'platinum', isBlacklisted: false },
      },
    ]);

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, {
        name: '最近人数分群',
        rules: combinedRule,
      });
      const id = created.json().data.id as string;

      const refreshed = await refreshSegment(app, cookie, id, 1);
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json()).toEqual({
        data: {
          total: 3,
          matched: 2,
          calculatedAt: testNow.toISOString(),
          revision: 1,
        },
      });

      const storedSnapshot = await db.prisma.segmentPreviewSnapshot.findUnique({
        where: { segmentId: id },
      });
      expect(storedSnapshot).toMatchObject({ revision: 1, total: 3, matched: 2 });
      expect(storedSnapshot?.calculatedAt).toEqual(testNow);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/segments/${id}`,
        headers: { cookie },
      });
      expect(detail.json().data.audienceEstimate).toEqual({
        revision: 1,
        total: 3,
        matched: 2,
        calculatedAt: testNow.toISOString(),
        isStale: false,
      });

      const listed = await app.inject({
        method: 'GET',
        url: '/api/segments',
        headers: { cookie },
      });
      expect(listed.json().data[0].audienceEstimate).toEqual(detail.json().data.audienceEstimate);

      const updated = await patchSegment(app, cookie, id, { revision: 1, name: '改名后的分群' });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().data.revision).toBe(2);
      expect(updated.json().data.audienceEstimate).toMatchObject({ revision: 1, isStale: true });
      expect(
        (await db.prisma.segmentPreviewSnapshot.findUnique({ where: { segmentId: id } }))?.revision,
      ).toBe(1);

      const beforeRefresh = await db.prisma.segment.findUnique({ where: { id } });
      const refreshedAgain = await refreshSegment(app, cookie, id, 2);
      expect(refreshedAgain.statusCode).toBe(200);
      expect(refreshedAgain.json().data).toMatchObject({ revision: 2, total: 3, matched: 2 });

      const afterRefresh = await db.prisma.segment.findUnique({ where: { id } });
      expect(afterRefresh).toMatchObject({
        revision: 2,
        updatedAt: beforeRefresh?.updatedAt,
        updatedById: beforeRefresh?.updatedById,
      });

      const detailAgain = await app.inject({
        method: 'GET',
        url: `/api/segments/${id}`,
        headers: { cookie },
      });
      expect(detailAgain.json().data.audienceEstimate).toMatchObject({
        revision: 2,
        isStale: false,
      });
    } finally {
      await app.close();
    }
  });

  it('刷新时修订号过期或分群不存在不会保存人数', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, { name: '刷新校验分群', rules: vipRule });
      const id = created.json().data.id as string;

      const stale = await refreshSegment(app, cookie, id, 2);
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('SEGMENT_REVISION_CONFLICT');
      expect(await db.prisma.segmentPreviewSnapshot.count()).toBe(0);

      const missing = await refreshSegment(app, cookie, missingId, 1);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.message).toBe('分群不存在');

      for (const payload of [
        { segmentId: id, revision: 1, rules: vipRule },
        { segmentId: 'not-a-uuid', revision: 1 },
        { segmentId: id, revision: 0 },
        { segmentId: id },
      ]) {
        expect((await previewSegment(app, cookie, payload)).statusCode).toBe(400);
      }
    } finally {
      await app.close();
    }
  });

  it('计算期间分群被修改时不写入旧结果', async () => {
    await seedAudience([
      {
        id: '00000000-0000-4000-8000-000000000121',
        externalId: 'seed:conflict:001',
        displayName: '黄金会员',
        email: 'gold@example.com',
        attributes: { vipLevel: 'gold', isBlacklisted: false },
      },
    ]);

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, {
        name: '计算冲突分群',
        rules: combinedRule,
      });
      const id = created.json().data.id as string;

      const originalFindUnique = db.prisma.segment.findUnique.bind(db.prisma.segment);
      vi.spyOn(db.prisma.segment, 'findUnique').mockImplementationOnce((args) => {
        const record = originalFindUnique(args);
        // 在初次读取规则之后、写入人数之前修改分群，验证写入时的修订号复核。
        return record.then(async (found) => {
          await db.prisma.segment.updateMany({ where: { id }, data: { revision: 2 } });
          return found;
        }) as unknown as typeof record;
      });

      const conflict = await refreshSegment(app, cookie, id, 1);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error.code).toBe('SEGMENT_REVISION_CONFLICT');
      expect(await db.prisma.segmentPreviewSnapshot.count()).toBe(0);
      expect((await db.prisma.segment.findUnique({ where: { id } }))?.revision).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('计算期间分群被删除时返回不存在且不留结果', async () => {
    await seedAudience([
      {
        id: '00000000-0000-4000-8000-000000000131',
        externalId: 'seed:deleted:001',
        displayName: '黄金会员',
        email: 'gold@example.com',
        attributes: { vipLevel: 'gold', isBlacklisted: false },
      },
    ]);

    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, {
        name: '计算删除分群',
        rules: combinedRule,
      });
      const id = created.json().data.id as string;

      const originalFindUnique = db.prisma.segment.findUnique.bind(db.prisma.segment);
      vi.spyOn(db.prisma.segment, 'findUnique').mockImplementationOnce((args) => {
        const record = originalFindUnique(args);
        // 在初次读取规则之后、写入人数之前删除分群，验证不会留下孤立结果。
        return record.then(async (found) => {
          await db.prisma.segment.deleteMany({ where: { id } });
          return found;
        }) as unknown as typeof record;
      });

      const missing = await refreshSegment(app, cookie, id, 1);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.message).toBe('分群不存在');
      expect(await db.prisma.segmentPreviewSnapshot.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('删除分群级联清理最近结果', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, { name: '级联删除分群', rules: vipRule });
      const id = created.json().data.id as string;
      expect((await refreshSegment(app, cookie, id, 1)).statusCode).toBe(200);
      expect(await db.prisma.segmentPreviewSnapshot.count({ where: { segmentId: id } })).toBe(1);

      expect((await deleteSegment(app, cookie, id)).statusCode).toBe(204);
      expect(await db.prisma.segmentPreviewSnapshot.count({ where: { segmentId: id } })).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('刷新人数失败时保留此前结果，不伪造新人数', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createSegment(app, cookie, { name: '失败保留分群', rules: vipRule });
      const id = created.json().data.id as string;
      expect((await refreshSegment(app, cookie, id, 1)).statusCode).toBe(200);

      vi.spyOn(db.prisma.audienceUser, 'findMany').mockRejectedValueOnce(
        new Error('database read failed'),
      );
      expect((await refreshSegment(app, cookie, id, 1)).statusCode).toBe(500);

      const snapshot = await db.prisma.segmentPreviewSnapshot.findUnique({
        where: { segmentId: id },
      });
      expect(snapshot).toMatchObject({ revision: 1, total: 0, matched: 0 });
    } finally {
      await app.close();
    }
  });
});
