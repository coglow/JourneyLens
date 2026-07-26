import { describe, expect, it } from 'vitest';
import {
  journeySimulationRequestSchema,
  journeySimulationScenarioSchema,
  simulationEvidenceValueSchema,
} from './journey-simulation.js';

const audienceId = '00000000-0000-4000-8300-000000000001';
const scenario = {
  user: { displayName: '张三', email: null, attributes: { age: 25 } },
  entryEvent: {
    id: 'entry-1',
    type: 'product_viewed',
    offsetSeconds: 0,
    payload: { productId: 'P-100', price: 199 },
  },
  historicalEvents: [
    {
      id: 'history-1',
      type: 'purchase_completed',
      offsetSeconds: -60,
      payload: { productId: 'P-200', amount: 80 },
    },
  ],
  scheduledEvents: [
    {
      id: 'future-1',
      type: 'purchase_completed',
      offsetSeconds: 7_200,
      payload: { productId: 'P-100', amount: 199 },
    },
  ],
} as const;

const definition = {
  layoutDirection: 'vertical' as const,
  nodes: [
    {
      id: 'start',
      type: 'start' as const,
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'product_viewed' as const,
    },
    { id: 'end', type: 'end' as const, name: '结束', position: { x: 0, y: 120 }, note: null },
  ],
  edges: [{ id: 'edge', source: 'start', target: 'end' }],
};

describe('模拟资料契约', () => {
  it('接受缺少字段、空值、数字 0、false 和空数组等合法资料', () => {
    expect(
      journeySimulationScenarioSchema.safeParse({
        ...scenario,
        user: {
          displayName: null,
          email: null,
          attributes: { age: 0, optInSms: false, interests: [] },
        },
        entryEvent: { ...scenario.entryEvent, payload: { productId: null, price: 0 } },
      }).success,
    ).toBe(true);
  });

  it('拒绝未知字段、错误类型、金额精度和非法时间方向', () => {
    expect(
      journeySimulationScenarioSchema.safeParse({
        ...scenario,
        user: { ...scenario.user, attributes: { age: '25' } },
      }).success,
    ).toBe(false);
    expect(
      journeySimulationScenarioSchema.safeParse({
        ...scenario,
        entryEvent: {
          ...scenario.entryEvent,
          payload: { ...scenario.entryEvent.payload, extra: 1 },
        },
      }).success,
    ).toBe(false);
    expect(
      journeySimulationScenarioSchema.safeParse({
        ...scenario,
        entryEvent: {
          ...scenario.entryEvent,
          payload: { ...scenario.entryEvent.payload, price: 1.234 },
        },
      }).success,
    ).toBe(false);
    expect(
      journeySimulationScenarioSchema.safeParse({
        ...scenario,
        historicalEvents: [{ ...scenario.historicalEvents[0]!, offsetSeconds: 0 }],
      }).success,
    ).toBe(false);
    expect(
      journeySimulationScenarioSchema.safeParse({
        ...scenario,
        scheduledEvents: [{ ...scenario.scheduledEvents[0]!, offsetSeconds: -1 }],
      }).success,
    ).toBe(false);
  });

  it('拒绝重复行为标识及超过 100 条的列表', () => {
    expect(
      journeySimulationScenarioSchema.safeParse({
        ...scenario,
        historicalEvents: [{ ...scenario.historicalEvents[0]!, id: scenario.entryEvent.id }],
      }).success,
    ).toBe(false);
    expect(
      journeySimulationScenarioSchema.safeParse({
        ...scenario,
        scheduledEvents: Array.from({ length: 101 }, (_, index) => ({
          id: `future-${index}`,
          type: 'purchase_completed',
          offsetSeconds: index,
          payload: {},
        })),
      }).success,
    ).toBe(false);
  });
});

describe('模拟请求契约', () => {
  it('只接受画布和本次完整资料，不再接受按编号回读的旧格式', () => {
    expect(
      journeySimulationRequestSchema.safeParse({ draftDefinition: definition, scenario }).success,
    ).toBe(true);
    expect(
      journeySimulationRequestSchema.safeParse({
        draftDefinition: definition,
        scenario,
        audienceUserId: audienceId,
      }).success,
    ).toBe(false);
  });
});

describe('结果证据契约', () => {
  it('区分没有属性和属性值为空', () => {
    expect(simulationEvidenceValueSchema.parse({ exists: false })).toEqual({ exists: false });
    expect(simulationEvidenceValueSchema.parse({ exists: true, value: null })).toEqual({
      exists: true,
      value: null,
    });
  });
});
