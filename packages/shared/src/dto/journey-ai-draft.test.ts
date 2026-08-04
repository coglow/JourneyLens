import { describe, expect, it } from 'vitest';
import {
  aiDraftQuestionSchema,
  journeyAiDraftRequestSchema,
  journeyAiDraftResultSchema,
} from './journey-ai-draft.js';

const readyDraft = {
  layoutDirection: 'vertical',
  nodes: [
    {
      id: 'n1',
      type: 'start',
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'product_viewed',
    },
    { id: 'n2', type: 'end', name: '结束', position: { x: 0, y: 200 }, note: null },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
};

const singleChoiceQuestion = {
  type: 'single_choice',
  label: '使用哪种提醒方式？',
  options: [
    { value: 'sms', label: '短信' },
    { value: 'push', label: '推送' },
  ],
};

describe('journeyAiDraftRequestSchema', () => {
  it('接受初次请求并去掉描述首尾空白', () => {
    const parsed = journeyAiDraftRequestSchema.safeParse({
      entryBehavior: 'product_viewed',
      description: '  等待一小时内购买同一商品。  ',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.description).toBe('等待一小时内购买同一商品。');
    expect(parsed.success && parsed.data.clarifications).toBeUndefined();
  });

  it('拒绝空描述、超长描述和非法进入行为', () => {
    expect(
      journeyAiDraftRequestSchema.safeParse({ entryBehavior: 'product_viewed', description: '   ' })
        .success,
    ).toBe(false);
    expect(
      journeyAiDraftRequestSchema.safeParse({
        entryBehavior: 'product_viewed',
        description: 'a'.repeat(2_001),
      }).success,
    ).toBe(false);
    expect(
      journeyAiDraftRequestSchema.safeParse({
        entryBehavior: 'unknown_behavior',
        description: '等待购买',
      }).success,
    ).toBe(false);
  });

  it('拒绝额外字段，例如生成阶段不接受修订号', () => {
    expect(
      journeyAiDraftRequestSchema.safeParse({
        entryBehavior: 'product_viewed',
        description: '等待购买',
        revision: 3,
      }).success,
    ).toBe(false);
  });

  it('接受两类成对补答', () => {
    const parsed = journeyAiDraftRequestSchema.safeParse({
      entryBehavior: 'product_viewed',
      description: '等待购买，超时提醒',
      clarifications: [
        { question: { type: 'text', label: '最长等待多久？' }, answer: '1 小时' },
        { question: singleChoiceQuestion, answer: 'sms' },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it('单选答案必须精确匹配选项值，短文本答案不能为空', () => {
    expect(
      journeyAiDraftRequestSchema.safeParse({
        entryBehavior: 'product_viewed',
        description: '等待购买',
        clarifications: [{ question: singleChoiceQuestion, answer: 'email' }],
      }).success,
    ).toBe(false);
    expect(
      journeyAiDraftRequestSchema.safeParse({
        entryBehavior: 'product_viewed',
        description: '等待购买',
        clarifications: [{ question: { type: 'text', label: '最长等待多久？' }, answer: '   ' }],
      }).success,
    ).toBe(false);
  });
});

describe('aiDraftQuestionSchema', () => {
  it('只接受短文本和单选，未知类型被拒绝', () => {
    expect(aiDraftQuestionSchema.safeParse({ type: 'number', label: '等待多久' }).success).toBe(
      false,
    );
    expect(aiDraftQuestionSchema.safeParse({ type: 'text', label: '等待多久' }).success).toBe(true);
  });

  it('单选要求 2 至 10 个不重复的选项', () => {
    expect(
      aiDraftQuestionSchema.safeParse({
        ...singleChoiceQuestion,
        options: [singleChoiceQuestion.options[0]],
      }).success,
    ).toBe(false);
    expect(
      aiDraftQuestionSchema.safeParse({
        ...singleChoiceQuestion,
        options: Array.from({ length: 11 }, (_, index) => ({
          value: `v${index}`,
          label: `选项 ${index}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      aiDraftQuestionSchema.safeParse({
        ...singleChoiceQuestion,
        options: [
          { value: 'sms', label: '短信' },
          { value: 'sms', label: '短信二' },
        ],
      }).success,
    ).toBe(false);
  });

  it('问题说明不能为空，也不能带额外字段', () => {
    expect(aiDraftQuestionSchema.safeParse({ type: 'text', label: '  ' }).success).toBe(false);
    expect(
      aiDraftQuestionSchema.safeParse({ type: 'text', label: '等待多久', required: true }).success,
    ).toBe(false);
  });
});

describe('journeyAiDraftResultSchema', () => {
  it('接受可应用候选', () => {
    const parsed = journeyAiDraftResultSchema.safeParse({
      status: 'ready',
      draftDefinition: readyDraft,
    });

    expect(parsed.success).toBe(true);
  });

  it('拒绝连线指向不存在节点的候选', () => {
    expect(
      journeyAiDraftResultSchema.safeParse({
        status: 'ready',
        draftDefinition: {
          ...readyDraft,
          edges: [{ id: 'e1', source: 'n1', target: 'missing' }],
        },
      }).success,
    ).toBe(false);
  });

  it('需要补充时问题数量为 1 至 5 条', () => {
    expect(
      journeyAiDraftResultSchema.safeParse({ status: 'needs_input', questions: [] }).success,
    ).toBe(false);
    expect(
      journeyAiDraftResultSchema.safeParse({
        status: 'needs_input',
        questions: Array.from({ length: 6 }, () => ({ type: 'text', label: '等待多久？' })),
      }).success,
    ).toBe(false);
    expect(
      journeyAiDraftResultSchema.safeParse({
        status: 'needs_input',
        questions: [{ type: 'text', label: '等待多久？' }],
      }).success,
    ).toBe(true);
  });

  it('不支持的说明不能为空', () => {
    expect(
      journeyAiDraftResultSchema.safeParse({ status: 'unsupported', reason: '  ' }).success,
    ).toBe(false);
    expect(
      journeyAiDraftResultSchema.safeParse({ status: 'unsupported', reason: '当前不支持自动发券' })
        .success,
    ).toBe(true);
  });

  it('结果类型之外的字段被拒绝', () => {
    expect(
      journeyAiDraftResultSchema.safeParse({
        status: 'unsupported',
        reason: '当前不支持自动发券',
        draftDefinition: readyDraft,
      }).success,
    ).toBe(false);
  });
});
