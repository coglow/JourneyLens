import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import {
  aiDraftQuestionsSchema,
  aiDraftUnsupportedResultSchema,
  getJourneyDraftWarnings,
  journeyDraftDefinitionSchema,
  type JourneyAiDraftResult,
  type JourneyDraftDefinition,
  type JourneyEventType,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';

const nodeRecordSchema = z.record(z.string(), z.unknown());

const modelOutputSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      nodes: z.array(nodeRecordSchema),
      edges: z.array(z.unknown()),
    })
    .strict(),
  z.object({ status: z.literal('needs_input'), questions: aiDraftQuestionsSchema }).strict(),
  aiDraftUnsupportedResultSchema,
]);

const READABLE_MESSAGE = /[\u4e00-\u9fa5]/;
const MAX_DETAILS = 3;

type NodeNames = readonly { readonly name?: unknown }[];

function describeIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  nodes: NodeNames,
): string[] | undefined {
  const details: string[] = [];
  for (const issue of issues) {
    if (!READABLE_MESSAGE.test(issue.message)) continue;
    const [root, index] = issue.path;
    const name =
      root === 'nodes' && typeof index === 'number' && index >= 0 ? nodes[index]?.name : undefined;
    const text =
      typeof name === 'string' && name.trim() !== ''
        ? `「${name}」：${issue.message}`
        : issue.message;
    if (!details.includes(text)) details.push(text);
  }

  if (details.length === 0) return undefined;
  if (details.length <= MAX_DETAILS) return details;
  return [...details.slice(0, MAX_DETAILS), `另有 ${details.length - MAX_DETAILS} 处需要一起调整`];
}

function invalidOutput(
  log: Pick<FastifyBaseLogger, 'warn'> | undefined,
  stage: string,
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  nodes: NodeNames = [],
): never {
  log?.warn(
    { stage, issues: issues.map(({ path, message }) => ({ path, message })) },
    'AI 起草结果未通过校验',
  );
  const details = describeIssues(issues, nodes);
  throw new ApiError(
    502,
    'AI_DRAFT_INVALID_OUTPUT',
    details === undefined
      ? '本次方案未通过流程检查，请重新生成或调整描述'
      : '本次方案未通过流程检查，请按提示调整描述后重新生成',
    details === undefined ? {} : { details },
  );
}

/** 为复用完整草稿校验，临时补齐必填坐标；前端预览和应用前会重新布局。 */
function toDraftDefinition(
  nodes: readonly Record<string, unknown>[],
  edges: readonly unknown[],
  log: Pick<FastifyBaseLogger, 'warn'> | undefined,
): JourneyDraftDefinition {
  const positioned: Array<Record<string, unknown>> = nodes.map((node, index) => {
    if (Object.hasOwn(node, 'position')) {
      invalidOutput(
        log,
        'node-position',
        [{ path: ['nodes', index, 'position'], message: '节点位置由前端计算' }],
        nodes,
      );
    }
    return { ...node, position: { x: 0, y: 0 } };
  });

  const parsed = journeyDraftDefinitionSchema.safeParse({ nodes: positioned, edges });
  if (!parsed.success) invalidOutput(log, 'draft', parsed.error.issues, positioned);
  return parsed.data;
}

/**
 * 解析并校验一次模型输出：只接受三种业务结果，可应用候选还必须通过
 * 现有草稿规则、完整性检查和开始行为一致性检查。
 */
export function parseAiDraftOutput(
  raw: string,
  entryBehavior: JourneyEventType,
  log?: Pick<FastifyBaseLogger, 'warn'>,
): JourneyAiDraftResult {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    invalidOutput(log, 'json', [{ path: [], message: '模型正文不是有效 JSON' }]);
  }

  const output = modelOutputSchema.safeParse(payload);
  if (!output.success) invalidOutput(log, 'result', output.error.issues);
  if (output.data.status !== 'ready') return output.data;

  const definition = toDraftDefinition(output.data.nodes, output.data.edges, log);
  const warnings = getJourneyDraftWarnings(definition);
  if (warnings.length > 0) {
    invalidOutput(
      log,
      'completeness',
      warnings.map(({ nodeIds, message }) => ({ path: ['nodes', ...nodeIds], message })),
    );
  }

  const startIndex = definition.nodes.findIndex((node) => node.type === 'start');
  const start = definition.nodes[startIndex];
  if (start?.type !== 'start' || start.entryBehavior !== entryBehavior) {
    invalidOutput(
      log,
      'entry-behavior',
      [{ path: ['nodes', startIndex, 'entryBehavior'], message: '开始行为与本次选择不一致' }],
      definition.nodes,
    );
  }

  return { status: 'ready', draftDefinition: definition };
}
