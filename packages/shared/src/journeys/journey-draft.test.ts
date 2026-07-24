import { describe, expect, it } from 'vitest';
import {
  getJourneyDraftGraphIssues,
  getJourneyDraftWarnings,
  journeyDraftDefinitionSchema,
  JOURNEY_ENTRY_BEHAVIORS,
  JOURNEY_MESSAGE_CHANNELS,
} from './journey-draft.js';

const vipRule = {
  kind: 'compare',
  left: { source: 'user', path: 'vipLevel' },
  operator: 'in',
  right: ['gold', 'platinum'],
};

function startNode(id = 'n-start', overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'start',
    name: '开始',
    position: { x: 0, y: 0 },
    entryBehavior: 'product_viewed',
    ...overrides,
  };
}

function conditionNode(id = 'n-condition', overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'condition',
    name: '高价值会员',
    position: { x: 200, y: 0 },
    rules: vipRule,
    ...overrides,
  };
}

function waitNode(id = 'n-wait', overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'wait',
    name: '等待一天',
    position: { x: 0, y: 200 },
    waitSeconds: 86_400,
    ...overrides,
  };
}

function messageNode(id = 'n-message', overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'message',
    name: '欢迎消息',
    position: { x: 200, y: 200 },
    channel: 'sms',
    subject: null,
    body: '欢迎回来',
    ...overrides,
  };
}

function endNode(id = 'n-end', overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'end',
    name: '结束',
    position: { x: 200, y: 400 },
    note: null,
    ...overrides,
  };
}

function edge(id: string, source: string, target: string, branch?: 'met' | 'unmet') {
  return branch === undefined ? { id, source, target } : { id, source, target, branch };
}

function completeDraft() {
  return {
    nodes: [startNode(), conditionNode(), waitNode(), messageNode(), endNode()],
    edges: [
      edge('e-start', 'n-start', 'n-condition'),
      edge('e-met', 'n-condition', 'n-wait', 'met'),
      edge('e-unmet', 'n-condition', 'n-message', 'unmet'),
      edge('e-wait', 'n-wait', 'n-message'),
      edge('e-end', 'n-message', 'n-end'),
    ],
  };
}

function firstIssueMessage(payload: unknown): string | undefined {
  const result = journeyDraftDefinitionSchema.safeParse(payload);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('旅程草稿契约', () => {
  it('图结构校验允许节点配置未完成，保存校验仍要求完整配置', () => {
    const nodes = [
      { id: 'start', type: 'start' },
      { id: 'message', type: 'message' },
    ] as const;
    const edges = [{ id: 'start-message', source: 'start', target: 'message' }];

    expect(getJourneyDraftGraphIssues(nodes, edges)).toEqual([]);
    expect(
      journeyDraftDefinitionSchema.safeParse({
        nodes: [startNode('start'), messageNode('message', { body: '' })],
        edges,
      }).success,
    ).toBe(false);
  });

  it('图结构校验复用节点、连线数量和分支出线限制', () => {
    const nodes = [
      { id: 'condition', type: 'condition' },
      { id: 'a', type: 'wait' },
      { id: 'b', type: 'wait' },
    ] as const;
    const edges = [edge('e1', 'condition', 'a', 'met'), edge('e2', 'condition', 'b', 'met')];

    expect(getJourneyDraftGraphIssues(nodes, edges)[0]?.message).toBe(
      '条件分支的“满足”路径只能连接一个下一步',
    );
    expect(getJourneyDraftGraphIssues([], [])).toEqual([
      { message: '请至少添加一个节点再保存', path: ['nodes'] },
    ]);
  });

  it('解析五类节点并规范化名称、正文和可空字段', () => {
    const parsed = journeyDraftDefinitionSchema.parse({
      nodes: [
        startNode(' n-start ', { name: '  开始  ' }),
        conditionNode(),
        waitNode(),
        messageNode('n-message', { name: ' 欢迎消息 ', body: '  欢迎回来  ' }),
        endNode('n-end', { note: '  ' }),
      ],
      edges: completeDraft().edges,
    });

    const [start, , , message, end] = parsed.nodes;
    expect(parsed.layoutDirection).toBe('vertical');
    expect(start).toMatchObject({ id: 'n-start', name: '开始', entryBehavior: 'product_viewed' });
    expect(message).toMatchObject({ name: '欢迎消息', body: '欢迎回来', subject: null });
    expect(end).toMatchObject({ note: null });
    expect(parsed.edges).toHaveLength(5);
  });

  it('只接受纵向或横向布局，并为旧草稿补上纵向默认值', () => {
    expect(journeyDraftDefinitionSchema.parse(completeDraft()).layoutDirection).toBe('vertical');
    expect(
      journeyDraftDefinitionSchema.safeParse({
        ...completeDraft(),
        layoutDirection: 'diagonal',
      }).success,
    ).toBe(false);
  });

  it('邮件必须填写主题，短信和推送不保存主题', () => {
    const email = {
      ...completeDraft(),
      nodes: [
        startNode(),
        conditionNode(),
        waitNode(),
        messageNode('n-message', { channel: 'email', subject: '  欢迎  ' }),
        endNode(),
      ],
    };
    const parsed = journeyDraftDefinitionSchema.parse(email);
    expect(parsed.nodes[3]).toMatchObject({ channel: 'email', subject: '欢迎' });

    expect(
      firstIssueMessage({
        ...email,
        nodes: email.nodes.map((node) =>
          node.id === 'n-message' ? { ...node, subject: null } : node,
        ),
      }),
    ).toBe('请填写邮件主题');

    expect(
      firstIssueMessage({
        ...completeDraft(),
        nodes: completeDraft().nodes.map((node) =>
          node.id === 'n-message' ? { ...node, subject: '不该保留' } : node,
        ),
      }),
    ).toBe('短信和推送不需要邮件主题');

    expect(
      firstIssueMessage({
        ...email,
        nodes: email.nodes.map((node) =>
          node.id === 'n-message' ? { ...node, subject: 'x'.repeat(201) } : node,
        ),
      }),
    ).toBe('邮件主题最多 200 个字符');
  });

  it('拒绝空图、重复标识、未知类型和非法字段值', () => {
    expect(firstIssueMessage({ nodes: [], edges: [] })).toBe('请至少添加一个节点再保存');

    expect(
      firstIssueMessage({
        nodes: [startNode(), startNode()],
        edges: [],
      }),
    ).toBe('节点标识重复，请检查后重试');

    expect(
      firstIssueMessage({
        nodes: [{ ...startNode(), entryBehavior: 'unknown_behavior' }],
        edges: [],
      }),
    ).toBe('请选择有效的进入行为');

    expect(
      firstIssueMessage({
        nodes: [{ ...startNode(), type: 'unknown' }],
        edges: [],
      }),
    ).not.toBeUndefined();

    for (const payload of [
      { nodes: [startNode('n', { name: '   ' })], edges: [] },
      { nodes: [startNode('n', { name: 'x'.repeat(121) })], edges: [] },
      { nodes: [waitNode('n', { waitSeconds: 0 })], edges: [] },
      { nodes: [waitNode('n', { waitSeconds: 1.5 })], edges: [] },
      { nodes: [waitNode('n', { waitSeconds: 30 * 24 * 60 * 60 + 1 })], edges: [] },
      { nodes: [messageNode('n', { body: '   ' })], edges: [] },
      { nodes: [messageNode('n', { body: 'x'.repeat(2001) })], edges: [] },
      { nodes: [endNode('n', { note: 'x'.repeat(501) })], edges: [] },
      { nodes: [startNode('n', { position: { x: 100_001, y: 0 } })], edges: [] },
      { nodes: [startNode('n', { position: { x: 0, y: -100_001 } })], edges: [] },
      { nodes: [startNode('n', { position: { x: Number.POSITIVE_INFINITY, y: 0 } })], edges: [] },
      { nodes: [startNode('n', { position: { x: Number.NaN, y: 0 } })], edges: [] },
      { nodes: [{ ...startNode(), extra: true }], edges: [] },
      { nodes: [startNode()], edges: [], extra: true },
    ]) {
      expect(journeyDraftDefinitionSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('最多 30 个节点和 60 条连线', () => {
    const nodes = Array.from({ length: 31 }, (_, index) => messageNode(`n-${index}`));
    expect(firstIssueMessage({ nodes, edges: [] })).toBe('一条旅程最多包含 30 个节点');

    const edges = Array.from({ length: 61 }, (_, index) => edge(`e-${index}`, 'n-start', 'n-end'));
    expect(firstIssueMessage({ nodes: [startNode(), endNode()], edges })).toBe(
      '一条旅程最多包含 60 条连线',
    );
  });

  it('连接规则拒绝自连、重复连线、非法方向和多余出线', () => {
    expect(
      firstIssueMessage({
        nodes: [startNode(), endNode()],
        edges: [edge('e', 'n-start', 'n-start')],
      }),
    ).toBe('连线不能把节点连到自己');

    expect(
      firstIssueMessage({
        nodes: [startNode(), endNode()],
        edges: [edge('e1', 'n-start', 'n-end'), edge('e2', 'n-start', 'n-end')],
      }),
    ).toBe('存在重复的连线，请删除多余的连线');

    expect(
      firstIssueMessage({
        nodes: [startNode(), messageNode()],
        edges: [edge('e', 'n-message', 'n-start')],
      }),
    ).toBe('连线不能指向开始节点');

    expect(
      firstIssueMessage({
        nodes: [startNode(), messageNode(), endNode()],
        edges: [edge('e1', 'n-start', 'n-message'), edge('e2', 'n-end', 'n-message')],
      }),
    ).toBe('结束节点后面不能再连接其他节点');

    expect(
      firstIssueMessage({
        nodes: [startNode(), conditionNode(), endNode()],
        edges: [edge('e1', 'n-start', 'n-condition'), edge('e2', 'n-condition', 'n-end')],
      }),
    ).toBe('条件分支的连线需要标明“满足”或“不满足”');

    expect(
      firstIssueMessage({
        nodes: [startNode(), endNode()],
        edges: [edge('e1', 'n-start', 'n-end'), edge('e2', 'n-start', 'n-end', 'met')],
      }),
    ).toBe('只有条件分支的连线才能标明“满足”或“不满足”');

    expect(
      firstIssueMessage({
        nodes: [startNode(), messageNode(), endNode('n-end'), endNode('n-end-2')],
        edges: [
          edge('e1', 'n-start', 'n-message'),
          edge('e2', 'n-message', 'n-end'),
          edge('e3', 'n-message', 'n-end-2'),
        ],
      }),
    ).toBe('一个节点只能连接一个下一步');

    expect(
      firstIssueMessage({
        nodes: [startNode(), conditionNode(), endNode(), endNode('n-end-2')],
        edges: [
          edge('e1', 'n-start', 'n-condition'),
          edge('e2', 'n-condition', 'n-end', 'met'),
          edge('e3', 'n-condition', 'n-end-2', 'met'),
        ],
      }),
    ).toBe('条件分支的“满足”路径只能连接一个下一步');
  });

  it('拒绝不存在的节点、两个开始节点和环路', () => {
    expect(
      firstIssueMessage({ nodes: [startNode()], edges: [edge('e', 'n-missing', 'n-start')] }),
    ).toBe('连线从已经删除的节点出发，请重新连接');

    expect(
      firstIssueMessage({ nodes: [startNode()], edges: [edge('e', 'n-start', 'n-missing')] }),
    ).toBe('连线指向了不存在的节点，请重新连接');

    expect(firstIssueMessage({ nodes: [startNode(), startNode('n-start-2')], edges: [] })).toBe(
      '一条旅程只能有一个开始节点',
    );

    expect(
      firstIssueMessage({
        nodes: [startNode(), messageNode('n-a'), messageNode('n-b'), endNode()],
        edges: [edge('e1', 'n-start', 'n-a'), edge('e2', 'n-a', 'n-b'), edge('e3', 'n-b', 'n-a')],
      }),
    ).toBe('连线形成了循环，请调整节点之间的连接');
  });

  it('未完成的连接允许保存，条件节点只接受一条比较判断', () => {
    const draft = journeyDraftDefinitionSchema.parse({
      nodes: [startNode(), messageNode('n-message')],
      edges: [edge('e1', 'n-start', 'n-message')],
    });
    expect(draft.nodes).toHaveLength(2);

    // 枚举属性选择多个比较值仍是一条判断，不属于组合结构。
    const multipleValues = journeyDraftDefinitionSchema.parse({
      nodes: [startNode(), conditionNode('n-condition'), endNode()],
      edges: [edge('e1', 'n-start', 'n-condition'), edge('e2', 'n-condition', 'n-end', 'met')],
    });
    expect(multipleValues.nodes[1]).toMatchObject({
      rules: { kind: 'compare', operator: 'in', right: ['gold', 'platinum'] },
    });

    const combinationRules = [
      { kind: 'all', children: [vipRule] },
      { kind: 'any', children: [vipRule] },
      { kind: 'not', child: vipRule },
    ];
    for (const rules of combinationRules) {
      expect(
        firstIssueMessage({
          nodes: [startNode(), conditionNode('n-condition', { rules }), endNode()],
          edges: [],
        }),
      ).toBe('这里只能设置一条比较条件');
    }
  });

  it('提示未连接的下一步、孤立节点和缺少结束节点', () => {
    expect(getJourneyDraftWarnings(journeyDraftDefinitionSchema.parse(completeDraft()))).toEqual(
      [],
    );

    const draft = journeyDraftDefinitionSchema.parse({
      nodes: [startNode(), conditionNode(), waitNode(), messageNode('n-message'), endNode()],
      edges: [edge('e1', 'n-start', 'n-condition'), edge('e2', 'n-condition', 'n-wait', 'met')],
    });
    const warnings = getJourneyDraftWarnings(draft);

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-branch',
          nodeIds: ['n-condition'],
          message: '「高价值会员」的“不满足”路径还没有连接。',
        }),
        expect.objectContaining({
          code: 'missing-next',
          nodeIds: ['n-wait'],
          message: '「等待一天」还没有连接下一步。',
        }),
        expect.objectContaining({
          code: 'unlinked-node',
          nodeIds: ['n-message'],
          message: '「欢迎消息」还没有连接到上一步。',
        }),
        expect.objectContaining({
          code: 'unlinked-node',
          nodeIds: ['n-end'],
        }),
      ]),
    );
    expect(warnings.some((warning) => warning.code === 'missing-end')).toBe(false);

    const withoutEnd = journeyDraftDefinitionSchema.parse({
      nodes: [startNode(), messageNode('n-message')],
      edges: [edge('e1', 'n-start', 'n-message')],
    });
    expect(getJourneyDraftWarnings(withoutEnd)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-end',
          nodeIds: [],
          message: '旅程还没有结束节点。',
        }),
      ]),
    );
  });

  it('七项进入行为和三种消息渠道来自同一份静态目录', () => {
    expect(JOURNEY_ENTRY_BEHAVIORS.map((item) => item.value)).toEqual([
      'product_viewed',
      'purchase_completed',
      'reservation_created',
      'app_session_started',
      'app_exit',
      'registration_completed',
      'subscription_started',
    ]);
    expect(JOURNEY_MESSAGE_CHANNELS.map((item) => item.value)).toEqual(['sms', 'push', 'email']);
  });
});
