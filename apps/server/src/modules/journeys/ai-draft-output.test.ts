import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../errors.js';
import { parseAiDraftOutput } from './ai-draft-output.js';

const readyNodes = [
  { id: 'n1', type: 'start', name: '开始', entryBehavior: 'product_viewed' },
  {
    id: 'n2',
    type: 'condition',
    name: '会员等级判断',
    rules: {
      kind: 'compare',
      left: { source: 'user', path: 'vipLevel' },
      operator: 'in',
      right: ['gold', 'platinum'],
    },
  },
  {
    id: 'n3',
    type: 'message',
    name: '短信提醒',
    channel: 'sms',
    subject: null,
    body: '欢迎按需查看商品详情。',
  },
  { id: 'n4', type: 'end', name: '结束', note: null },
];

const readyEdges = [
  { id: 'e1', source: 'n1', target: 'n2' },
  { id: 'e2', source: 'n2', target: 'n3', branch: 'met' },
  { id: 'e3', source: 'n2', target: 'n4', branch: 'unmet' },
  { id: 'e4', source: 'n3', target: 'n4' },
];

function readyRaw(overrides: { nodes?: unknown; edges?: unknown } = {}): string {
  return JSON.stringify({
    status: 'ready',
    nodes: overrides.nodes ?? readyNodes,
    edges: overrides.edges ?? readyEdges,
  });
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('预期抛出无效输出错误，但调用成功返回');
}

function expectInvalidOutput(run: () => unknown): void {
  const error = captureError(run);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ statusCode: 502, code: 'AI_DRAFT_INVALID_OUTPUT' });
}

describe('parseAiDraftOutput', () => {
  it('记录真实生成的类目多选错误位置，合法单值写法可用且不静默修正', () => {
    const log = { warn: vi.fn() };
    const categoryNodes = readyNodes.map((node) =>
      node.type === 'condition'
        ? {
            id: node.id,
            type: node.type,
            name: '数码商品',
            rules: {
              kind: 'compare',
              left: { source: 'entry_event', eventType: 'product_viewed', path: 'category' },
              operator: 'in',
              right: ['electronics'],
            },
          }
        : node,
    );
    expectInvalidOutput(() =>
      parseAiDraftOutput(readyRaw({ nodes: categoryNodes }), 'product_viewed', log),
    );
    expect(log.warn).toHaveBeenCalledWith(
      {
        stage: 'draft',
        issues: [
          {
            path: ['nodes', 1, 'rules', 'right'],
            message: '行为属性只能填写单个比较值，不能填写多个值',
          },
        ],
      },
      'AI 起草结果未通过校验',
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('欢迎按需查看商品详情');

    const corrected = categoryNodes.map((node) =>
      node.type === 'condition'
        ? {
            ...node,
            rules: { ...node.rules, operator: 'eq', right: 'electronics' },
          }
        : node,
    );
    expect(parseAiDraftOutput(readyRaw({ nodes: corrected }), 'product_viewed').status).toBe(
      'ready',
    );
  });

  it('区分正文解析失败、流程缺失和进入行为不一致', () => {
    const log = { warn: vi.fn() };
    expectInvalidOutput(() => parseAiDraftOutput('原始正文不进入日志', 'product_viewed', log));
    expect(log.warn.mock.calls.at(-1)?.[0].stage).toBe('json');
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('原始正文不进入日志');
    expectInvalidOutput(() =>
      parseAiDraftOutput(readyRaw({ edges: readyEdges.slice(0, 2) }), 'product_viewed', log),
    );
    expect(log.warn.mock.calls.at(-1)?.[0].stage).toBe('completeness');
    expectInvalidOutput(() => parseAiDraftOutput(readyRaw(), 'registration_completed', log));
    expect(log.warn.mock.calls.at(-1)?.[0].stage).toBe('entry-behavior');
  });

  it('补上占位坐标并返回可应用候选', () => {
    const result = parseAiDraftOutput(readyRaw(), 'product_viewed');

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.draftDefinition.nodes).toHaveLength(4);
    expect(result.draftDefinition.nodes.every((node) => node.position.x === 0)).toBe(true);
    expect(result.draftDefinition.layoutDirection).toBe('vertical');
  });

  it('开始行为与本次选择不一致时拒绝，不自动改成选择的那个', () => {
    expectInvalidOutput(() =>
      parseAiDraftOutput(
        readyRaw({
          nodes: readyNodes.map((node) =>
            node.type === 'start' ? { ...node, entryBehavior: 'purchase_completed' } : node,
          ),
        }),
        'product_viewed',
      ),
    );
  });

  it('模型自带坐标时拒绝，坐标只由前端计算', () => {
    expectInvalidOutput(() =>
      parseAiDraftOutput(
        readyRaw({
          nodes: readyNodes.map((node) => ({ ...node, position: { x: 10, y: 10 } })),
        }),
        'product_viewed',
      ),
    );
  });

  it('缺少分支或下一步时按未通过流程检查处理', () => {
    expectInvalidOutput(() =>
      parseAiDraftOutput(readyRaw({ edges: readyEdges.slice(0, 2) }), 'product_viewed'),
    );
  });

  it('布尔条件写成中文字符串时给出可定位的原因，而不是只说生成失败', () => {
    const smsNodes = readyNodes.map((node) =>
      node.type === 'condition'
        ? {
            ...node,
            name: '短信订阅判断',
            rules: {
              kind: 'compare',
              left: { source: 'user', path: 'optInSms' },
              operator: 'eq',
              right: '是',
            },
          }
        : node,
    );

    const error = captureError(() =>
      parseAiDraftOutput(readyRaw({ nodes: smsNodes }), 'product_viewed'),
    );

    expect(error).toMatchObject({
      statusCode: 502,
      code: 'AI_DRAFT_INVALID_OUTPUT',
      message: '本次方案未通过流程检查，请按提示调整描述后重新生成',
      details: ['「短信订阅判断」：请选择“是”或“否”'],
    });
  });

  it('条件规则不符合现有字段校验时拒绝', () => {
    expectInvalidOutput(() =>
      parseAiDraftOutput(
        readyRaw({
          nodes: readyNodes.map((node) =>
            node.type === 'condition'
              ? {
                  ...node,
                  rules: {
                    kind: 'compare',
                    left: { source: 'user', path: 'vipLevel' },
                    operator: 'gt',
                    right: 'gold',
                  },
                }
              : node,
          ),
        }),
        'product_viewed',
      ),
    );
  });

  it('返回需要补充的问题', () => {
    const result = parseAiDraftOutput(
      JSON.stringify({
        status: 'needs_input',
        questions: [{ type: 'text', label: '最长等待多久？请带上单位。' }],
      }),
      'product_viewed',
    );

    expect(result).toEqual({
      status: 'needs_input',
      questions: [{ type: 'text', label: '最长等待多久？请带上单位。' }],
    });
  });

  it('问题数量超出上限或类型未知时拒绝', () => {
    expectInvalidOutput(() =>
      parseAiDraftOutput(
        JSON.stringify({
          status: 'needs_input',
          questions: Array.from({ length: 6 }, () => ({ type: 'text', label: '等待多久？' })),
        }),
        'product_viewed',
      ),
    );
    expectInvalidOutput(() =>
      parseAiDraftOutput(
        JSON.stringify({
          status: 'needs_input',
          questions: [{ type: 'number', label: '等待多久？' }],
        }),
        'product_viewed',
      ),
    );
  });

  it('返回不支持的业务说明', () => {
    expect(
      parseAiDraftOutput(
        JSON.stringify({ status: 'unsupported', reason: '当前不支持自动发券' }),
        'product_viewed',
      ),
    ).toEqual({ status: 'unsupported', reason: '当前不支持自动发券' });
  });

  it('非 json、未知结果类型和多余字段都拒绝', () => {
    expectInvalidOutput(() => parseAiDraftOutput('不是 json', 'product_viewed'));
    expectInvalidOutput(() =>
      parseAiDraftOutput(JSON.stringify({ status: 'done' }), 'product_viewed'),
    );
    expectInvalidOutput(() =>
      parseAiDraftOutput(
        JSON.stringify({ status: 'ready', nodes: readyNodes, edges: readyEdges, note: '补充说明' }),
        'product_viewed',
      ),
    );
  });
});
