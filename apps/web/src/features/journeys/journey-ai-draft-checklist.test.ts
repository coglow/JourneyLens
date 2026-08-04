import { describe, expect, it } from 'vitest';
import type { JourneyDraftDefinition } from '@journeylens/shared';
import { buildAiDraftChecklist } from './journey-ai-draft-checklist';

const definition: JourneyDraftDefinition = {
  layoutDirection: 'vertical',
  nodes: [
    {
      id: 'n1',
      type: 'start',
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'product_viewed',
    },
    {
      id: 'n2',
      type: 'condition',
      name: '会员判断',
      position: { x: 0, y: 120 },
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
      position: { x: -200, y: 240 },
      channel: 'sms',
      subject: null,
      body: '欢迎按需查看商品详情。',
    },
    { id: 'n4', type: 'end', name: '结束', position: { x: 200, y: 240 }, note: null },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3', branch: 'met' },
    { id: 'e3', source: 'n2', target: 'n4', branch: 'unmet' },
    { id: 'e4', source: 'n3', target: 'n4' },
  ],
};

describe('buildAiDraftChecklist', () => {
  it('从开始步骤按流程顺序组织，汇合步骤只出现一次', () => {
    const checklist = buildAiDraftChecklist(definition);

    expect(checklist.map((entry) => entry.node.name)).toEqual([
      '开始',
      '会员判断',
      '短信提醒',
      '结束',
    ]);
    expect(checklist.map((entry) => entry.order)).toEqual([1, 2, 3, 4]);
  });

  it('保留分支去向与普通下一步的差别', () => {
    const checklist = buildAiDraftChecklist(definition);

    expect(checklist[0]?.next).toEqual([{ label: '下一步', targetName: '会员判断' }]);
    expect(checklist[1]?.next).toEqual([
      { label: '满足', targetName: '短信提醒' },
      { label: '不满足', targetName: '结束' },
    ]);
    expect(checklist[3]?.next).toEqual([]);
  });

  it('未被连到的步骤排在最后，便于发现遗漏', () => {
    const checklist = buildAiDraftChecklist({
      ...definition,
      nodes: [
        ...definition.nodes,
        { id: 'n5', type: 'end', name: '孤立结束', position: { x: 0, y: 400 }, note: null },
      ],
    });

    expect(checklist.at(-1)?.node.name).toBe('孤立结束');
    expect(checklist).toHaveLength(5);
  });
});
