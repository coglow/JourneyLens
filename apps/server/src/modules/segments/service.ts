import { Prisma, type PrismaClient } from '@prisma/client';
import {
  SEGMENT_PREVIEW_LIMIT,
  analyzeSegmentRuleSatisfiability,
  type SegmentAudienceEstimate,
  type SegmentCreate,
  type SegmentDetail,
  type SegmentListItem,
  type SegmentListQuery,
  type PaginationQuery,
  type SegmentPreview,
  type SegmentRefreshPreview,
  type SegmentRule,
  type SegmentUpdate,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { evaluateSegmentRule } from './rule-evaluator.js';

const estimateSelect = {
  revision: true,
  total: true,
  matched: true,
  calculatedAt: true,
} as const;

const segmentDetailSelect = {
  id: true,
  name: true,
  description: true,
  rules: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
  previewSnapshot: { select: estimateSelect },
  _count: { select: { journeys: true } },
} as const;

const segmentListItemSelect = {
  id: true,
  name: true,
  description: true,
  rules: true,
  revision: true,
  updatedAt: true,
  previewSnapshot: { select: estimateSelect },
  _count: { select: { journeys: true } },
} as const;

type SegmentDetailRecord = Prisma.SegmentGetPayload<{ select: typeof segmentDetailSelect }>;
type SegmentListItemRecord = Prisma.SegmentGetPayload<{ select: typeof segmentListItemSelect }>;
type SegmentEstimateRecord = Prisma.SegmentPreviewSnapshotGetPayload<{
  select: typeof estimateSelect;
}>;

function rulesToJson(rules: SegmentRule): Prisma.InputJsonValue {
  return rules as unknown as Prisma.InputJsonValue;
}

function rulesFromJson(rules: Prisma.JsonValue): SegmentRule {
  return rules as unknown as SegmentRule;
}

/** 最近结果只保留一份；修订号与当前分群不同就提示需要重新计算。 */
function serializeEstimate(
  snapshot: SegmentEstimateRecord | null,
  currentRevision: number,
): SegmentAudienceEstimate | null {
  if (snapshot === null) return null;
  return {
    revision: snapshot.revision,
    total: snapshot.total,
    matched: snapshot.matched,
    calculatedAt: snapshot.calculatedAt.toISOString(),
    isStale: snapshot.revision !== currentRevision,
  };
}

function serializeDetail(record: SegmentDetailRecord): SegmentDetail {
  const { previewSnapshot, _count, ...detail } = record;
  return {
    ...detail,
    journeyCount: _count.journeys,
    rules: rulesFromJson(record.rules),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    audienceEstimate: serializeEstimate(previewSnapshot, record.revision),
  };
}

function serializeListItem(record: SegmentListItemRecord): SegmentListItem {
  const { previewSnapshot, revision, _count, ...item } = record;
  return {
    ...item,
    journeyCount: _count.journeys,
    rules: rulesFromJson(record.rules),
    updatedAt: record.updatedAt.toISOString(),
    audienceEstimate: serializeEstimate(previewSnapshot, revision),
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function searchFilter(q: string | undefined): Prisma.SegmentWhereInput {
  if (q === undefined) return {};
  const contains = escapeLikePattern(q);
  return {
    OR: [
      { name: { contains, mode: 'insensitive' } },
      { description: { contains, mode: 'insensitive' } },
    ],
  };
}

function nameTaken(): ApiError {
  return new ApiError(409, 'SEGMENT_NAME_TAKEN', '分群名称已存在');
}

function revisionConflict(): ApiError {
  return new ApiError(409, 'SEGMENT_REVISION_CONFLICT', '分群已被修改，请重新读取后再保存');
}

/**
 * 与前端共用的纯分析器：只拦截能够证明整体不可能命中的规则。
 * 分支矛盾和“当前样本零人”都不属于此列；
 */
function assertRulesSatisfiable(rules: SegmentRule): void {
  const analysis = analyzeSegmentRuleSatisfiability(rules);
  if (!analysis.rootUnsatisfiable) return;

  const reason = analysis.findings.find(
    (finding) => finding.path.length === 0 && finding.kind === 'unsatisfiable',
  )?.message;
  throw new ApiError(
    400,
    'SEGMENT_RULE_UNSATISFIABLE',
    (reason ?? '分群条件互相矛盾，无法筛选出用户。请修改冲突的条件。').slice(0, 400),
  );
}

function rethrowUniqueName(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw nameTaken();
  }
  throw error;
}

export class SegmentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(input: SegmentListQuery) {
    const where = searchFilter(input.q);
    const total = await this.prisma.segment.count({ where });
    // 删除或筛选后页码可能越界，直接落到最后一个有效页；空数据时回到第 1 页。
    const lastPage = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, lastPage);
    const records = await this.prisma.segment.findMany({
      where,
      skip: (page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: segmentListItemSelect,
    });

    return {
      data: records.map(serializeListItem),
      page: { page, pageSize: input.pageSize, total },
    };
  }

  async create(input: SegmentCreate, accountId: string): Promise<SegmentDetail> {
    assertRulesSatisfiable(input.rules);
    try {
      const record = await this.prisma.segment.create({
        data: {
          name: input.name,
          description: input.description,
          rules: rulesToJson(input.rules),
          createdById: accountId,
          updatedById: accountId,
        },
        select: segmentDetailSelect,
      });
      return serializeDetail(record);
    } catch (error) {
      return rethrowUniqueName(error);
    }
  }

  async get(id: string): Promise<SegmentDetail | null> {
    const record = await this.prisma.segment.findUnique({
      where: { id },
      select: segmentDetailSelect,
    });
    return record === null ? null : serializeDetail(record);
  }

  async update(id: string, input: SegmentUpdate, accountId: string): Promise<SegmentDetail> {
    // 只检查即将保存的规则；只改名称或说明时不去分析数据库里的旧规则。
    if (input.rules !== undefined) assertRulesSatisfiable(input.rules);

    // revision 同时出现在条件里；只有读取后未被别人改过，更新才会命中。
    const data: Prisma.SegmentUncheckedUpdateManyInput = {
      revision: { increment: 1 },
      updatedById: accountId,
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.rules !== undefined) data.rules = rulesToJson(input.rules);

    let count: number;
    try {
      const result = await this.prisma.segment.updateMany({
        where: { id, revision: input.revision },
        data,
      });
      count = result.count;
    } catch (error) {
      return rethrowUniqueName(error);
    }

    if (count === 0) {
      // 更新数为 0 有两种原因：记录不存在，或 revision 已过期；要分开反馈。
      const existing = await this.prisma.segment.findUnique({
        where: { id },
        select: { revision: true },
      });
      if (existing === null) throw new ApiError(404, 'NOT_FOUND', '分群不存在');
      throw revisionConflict();
    }

    const updated = await this.get(id);
    if (updated === null) throw new ApiError(404, 'NOT_FOUND', '分群不存在');
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.prisma.segment.deleteMany({ where: { id } });
      return result.count > 0;
    } catch (error) {
      // journeys.segment_id 使用 RESTRICT：仍有旅程引用时由数据库阻止删除，这里转换成明确提示。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ApiError(409, 'SEGMENT_IN_USE', '分群正在被旅程使用，请先更换或解除关联');
      }
      throw error;
    }
  }

  /** 分群引用列表：展示引用该分群的旅程，供删除前确认影响范围。 */
  async usages(segmentId: string, input: PaginationQuery) {
    // 分群不存在时明确反馈，不返回看似正常的空列表。
    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId },
      select: { id: true },
    });
    if (segment === null) throw new ApiError(404, 'NOT_FOUND', '分群不存在');

    const where: Prisma.JourneyWhereInput = { segmentId };
    const total = await this.prisma.journey.count({ where });
    // 删除或筛选后页码可能越界，直接落到最后一个有效页；空数据时回到第 1 页。
    const lastPage = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, lastPage);
    const records = await this.prisma.journey.findMany({
      where,
      skip: (page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        updatedAt: true,
        campaign: { select: { id: true, name: true, status: true } },
      },
    });

    return {
      data: records.map((record) => ({
        journey: { id: record.id, name: record.name },
        campaign: record.campaign,
        updatedAt: record.updatedAt.toISOString(),
      })),
      page: { page, pageSize: input.pageSize, total },
    };
  }

  /** 试算只返回人数，不写库； */
  async preview(rules: SegmentRule): Promise<SegmentPreview> {
    const result = await this.calculate(rules);
    return { ...result, calculatedAt: this.now().toISOString() };
  }

  /**
   * 明确刷新已保存分群的人数。
   * 计算在事务外完成，写入时锁定分群行并重新核对修订号；
   * 计算期间被修改或删除时，不把旧规则的结果写成当前结果。
   */
  async refresh(segmentId: string, revision: number): Promise<SegmentRefreshPreview> {
    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId },
      select: { rules: true, revision: true },
    });
    if (segment === null) throw new ApiError(404, 'NOT_FOUND', '分群不存在');
    if (segment.revision !== revision) throw revisionConflict();

    const result = await this.calculate(rulesFromJson(segment.rules));
    const calculatedAt = this.now();

    const saved = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ revision: number }>>`
        SELECT "revision" FROM "segments" WHERE "id" = ${segmentId}::uuid FOR UPDATE
      `;
      const current = rows[0];
      if (current === undefined) return 'missing' as const;
      if (current.revision !== revision) return 'conflict' as const;

      await transaction.segmentPreviewSnapshot.upsert({
        where: { segmentId },
        update: { revision, total: result.total, matched: result.matched, calculatedAt },
        create: { segmentId, revision, total: result.total, matched: result.matched, calculatedAt },
      });
      return 'saved' as const;
    });

    if (saved === 'missing') throw new ApiError(404, 'NOT_FOUND', '分群不存在');
    if (saved === 'conflict') throw revisionConflict();

    return {
      ...result,
      calculatedAt: calculatedAt.toISOString(),
      revision,
    };
  }

  private async calculate(rules: SegmentRule): Promise<{ total: number; matched: number }> {
    // 多读 1 行只用于判断是否超限；总人数和命中数来自同一批数据，口径一致。
    const users = await this.prisma.audienceUser.findMany({
      take: SEGMENT_PREVIEW_LIMIT + 1,
      select: { displayName: true, email: true, attributes: true },
    });
    if (users.length > SEGMENT_PREVIEW_LIMIT) {
      throw new ApiError(
        422,
        'AUDIENCE_TOO_LARGE',
        `当前受众超过 ${SEGMENT_PREVIEW_LIMIT} 人，暂不支持计算`,
      );
    }

    let matched = 0;
    for (const user of users) {
      if (evaluateSegmentRule(rules, user)) matched += 1;
    }
    return { total: users.length, matched };
  }
}
