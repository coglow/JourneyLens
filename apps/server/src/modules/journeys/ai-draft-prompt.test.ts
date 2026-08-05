import { describe, expect, it } from 'vitest';
import { journeyConditionRuleSchema } from '@journeylens/shared';
import { buildAiDraftMessages } from './ai-draft-prompt.js';

const messages = buildAiDraftMessages({
  entryBehavior: 'product_viewed',
  description: '浏览数码商品后跟进，不承诺库存。',
});
const system = messages[0]!.content;

describe('AI 起草提示约束', () => {
  it('行为类目列出单值比较方式，提供能通过真实校验的类目示例', () => {
    const eventLine = system.split('\n').find((line) => line.startsWith('- product_viewed（'))!;
    const category = eventLine.slice(
      eventLine.indexOf('商品类目（'),
      eventLine.indexOf('商品价格（'),
    );
    expect(category).toContain('eq=等于、neq=不等于、exists=已填写');
    expect(category).not.toContain('in=属于');
    expect(system).toContain('行为属性不接受数组');
    expect(system).toContain('同样适用于行为次数和等待行为的 filter');

    const example = system.match(/例如商品类目判断写 (.+)。/)!;
    expect(journeyConditionRuleSchema.parse(JSON.parse(example[1]!))).toMatchObject({
      left: { source: 'entry_event', path: 'category' },
      operator: 'eq',
      right: 'electronics',
    });
  });

  it('布尔属性明确要求 true/false，并提供能通过真实校验的示例', () => {
    const smsLine = system.split('\n').find((line) => line.startsWith('- optInSms（'))!;
    expect(smsLine).toContain('只能是 JSON 布尔值 true 或 false');
    expect(system).toContain('不能写“是”“否”，也不能写成 "true" 字符串');

    const example = system.match(/布尔属性条件示例[^\n]*\n(\{.*\})/)!;
    const exampleNode = JSON.parse(example[1]!) as { rules: unknown };
    expect(journeyConditionRuleSchema.parse(exampleNode.rules)).toMatchObject({
      left: { source: 'user', path: 'optInSms' },
      operator: 'eq',
      right: true,
    });
  });

  it('禁止将零订单推断为首次访问，以及编造库存或已执行操作', () => {
    expect(system).toContain('不能由累计订单数为零推断“第一次来逛”');
    expect(system).toContain('不能编造“已为您保留在浏览记录中”');
    expect(system).toContain('不写“商品还在”“有货”“已保留”等承诺');
    expect(system).toContain('欢迎按需查看商品详情');
  });

  it('只开放两个消息变量，并说明商品名称的进入行为范围', () => {
    expect(system).toContain('{{用户昵称}}');
    expect(system).toContain('{{商品名称}}');
    expect(system).toContain('只有浏览商品、完成购买、创建预约可以读取');
    expect(system).not.toContain('不要使用模板变量');
  });
});
