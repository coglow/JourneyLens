import { renderJourneyMessage } from '@journeylens/shared';
import type {
  JourneyConditionRule,
  JourneyDraftDefinition,
  JourneyDraftEdge,
  JourneyDraftNode,
  JourneySimulationResult,
  JourneySimulationScenario,
  JourneySimulationStep,
  SegmentRule,
  SimulationJsonValue,
} from '@journeylens/shared';
import {
  compareSegmentValue,
  evaluateSegmentRule,
  readSegmentRuleValue,
  type SegmentAudienceInput,
} from '../segments/rule-evaluator.js';
import {
  buildSimulationFacts,
  countMatchingEvents,
  type SimulationFact,
  waitForMatchingEvent,
} from './simulation-events.js';

/** 模拟中的消息内容替换后超长；由服务层转换成现有请求失败反馈，不新增模拟终态。 */
export class JourneySimulationMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JourneySimulationMessageError';
  }
}

export interface SimulationInput {
  /** 请求中的画布和场景均已由共享契约校验，纯计算不读写数据库。 */
  definition: JourneyDraftDefinition;
  scenario: JourneySimulationScenario;
  segment: { id: string; name: string; rules: SegmentRule } | null;
}

type JourneyConditionEvidence = Extract<
  JourneySimulationStep,
  { nodeType: 'condition' }
>['evidence'];

function baseStep(node: JourneyDraftNode, order: number, elapsedSeconds: number) {
  return { order, nodeId: node.id, nodeName: node.name, elapsedSeconds };
}

function readEventValue(event: SimulationFact, path: string): unknown {
  return Object.hasOwn(event.payload, path) ? event.payload[path] : undefined;
}

function toEvidenceValue(value: unknown) {
  return value === undefined
    ? { exists: false as const }
    : { exists: true as const, value: value as SimulationJsonValue };
}

function evaluateJourneyCondition(input: {
  rule: JourneyConditionRule;
  user: SegmentAudienceInput;
  entryFact: SimulationFact;
  facts: readonly SimulationFact[];
  atSeconds: number;
}): { matched: boolean; evidence: JourneyConditionEvidence } {
  const { rule } = input;
  if (rule.kind === 'event_count') {
    const result = countMatchingEvents({
      facts: input.facts,
      entryEvent: input.entryFact,
      atSeconds: input.atSeconds,
      eventType: rule.eventType,
      windowSeconds: rule.windowSeconds,
      ...(rule.filter === undefined ? {} : { filter: rule.filter }),
      sameProduct: rule.sameProduct,
    });
    return {
      matched: compareSegmentValue(result.count, rule.operator, rule.right),
      evidence: {
        kind: 'event_count',
        evaluatedAtSeconds: input.atSeconds,
        windowStartSeconds: input.atSeconds - rule.windowSeconds,
        windowEndSeconds: input.atSeconds,
        count: result.count,
        checks: result.checks,
      },
    };
  }

  const actual =
    rule.left.source === 'user'
      ? readSegmentRuleValue(input.user, rule.left.path)
      : readEventValue(input.entryFact, rule.left.path);
  return {
    matched: compareSegmentValue(actual, rule.operator, rule.right),
    evidence: { kind: 'value', actual: toEvidenceValue(actual) },
  };
}

/** 按实际连线推进同一个整数秒时钟，条件证据来自输入快照而不是数据库。 */
export function simulateJourney(input: SimulationInput): JourneySimulationResult {
  const { definition, scenario, segment } = input;
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const edgesBySource = new Map<string, JourneyDraftEdge[]>();
  for (const edge of definition.edges) {
    const edges = edgesBySource.get(edge.source);
    if (edges === undefined) edgesBySource.set(edge.source, [edge]);
    else edges.push(edge);
  }

  const start = definition.nodes.find((node) => node.type === 'start');
  if (start === undefined || start.type !== 'start') throw new Error('模拟需要开始步骤');

  const user: SegmentAudienceInput = {
    displayName: scenario.user.displayName,
    email: scenario.user.email,
    attributes: scenario.user.attributes,
  };
  const entryFact: SimulationFact = {
    ...scenario.entryEvent,
    payload: scenario.entryEvent.payload,
  };
  const facts = buildSimulationFacts(scenario);
  const entryMatched = start.entryBehavior === scenario.entryEvent.type;
  const segmentMatched = segment === null ? null : evaluateSegmentRule(segment.rules, user);
  const admission = {
    entryBehavior: {
      expected: start.entryBehavior,
      actual: scenario.entryEvent.type,
      matched: entryMatched,
    },
    segment:
      segment === null
        ? null
        : {
            id: segment.id,
            name: segment.name,
            rules: segment.rules,
            matched: segmentMatched === true,
          },
  };
  const publicUser = { displayName: scenario.user.displayName };

  if (!entryMatched || segmentMatched === false) {
    return {
      outcome: 'not_entered',
      user: publicUser,
      admission,
      steps: [],
      traversedEdgeIds: [],
      elapsedSeconds: 0,
    };
  }

  const steps: JourneySimulationStep[] = [];
  const traversedEdgeIds: string[] = [];
  const usedEventIds = new Set<string>();
  let current: JourneyDraftNode = start;
  let elapsedSeconds = 0;
  let order = 1;

  function nextNode(sourceId: string, branch?: 'met' | 'unmet' | 'matched' | 'timeout') {
    const edges = edgesBySource.get(sourceId) ?? [];
    const edge = branch === undefined ? edges[0] : edges.find((item) => item.branch === branch);
    if (edge === undefined) throw new Error('流程缺少下一步');
    const target = nodesById.get(edge.target);
    if (target === undefined) throw new Error('连线指向的步骤不存在');
    traversedEdgeIds.push(edge.id);
    return target;
  }

  for (;;) {
    if (current.type === 'start') {
      steps.push({
        ...baseStep(current, order, elapsedSeconds),
        nodeType: 'start',
        entryBehavior: current.entryBehavior,
      });
      order += 1;
      current = nextNode(current.id);
      continue;
    }

    if (current.type === 'condition') {
      const result = evaluateJourneyCondition({
        rule: current.rules,
        user,
        entryFact,
        facts,
        atSeconds: elapsedSeconds,
      });
      const branch = result.matched ? 'met' : 'unmet';
      steps.push({
        ...baseStep(current, order, elapsedSeconds),
        nodeType: 'condition',
        rule: current.rules,
        matched: result.matched,
        branch,
        evidence: result.evidence,
      });
      order += 1;
      current = nextNode(current.id, branch);
      continue;
    }

    if (current.type === 'wait') {
      const elapsedBefore = elapsedSeconds;
      elapsedSeconds += current.waitSeconds;
      steps.push({
        ...baseStep(current, order, elapsedBefore),
        nodeType: 'wait',
        waitSeconds: current.waitSeconds,
        elapsedBefore,
        elapsedAfter: elapsedSeconds,
      });
      order += 1;
      current = nextNode(current.id);
      continue;
    }

    if (current.type === 'wait_for_event') {
      const result = waitForMatchingEvent({
        scenario,
        entryFact,
        startedAtSeconds: elapsedSeconds,
        waitSeconds: current.waitSeconds,
        eventType: current.eventType,
        ...(current.filter === undefined ? {} : { filter: current.filter }),
        sameProduct: current.sameProduct,
        usedEventIds,
      });
      if (result.matchedEventId !== null) usedEventIds.add(result.matchedEventId);
      steps.push({
        ...baseStep(current, order, elapsedSeconds),
        nodeType: 'wait_for_event',
        config: {
          eventType: current.eventType,
          waitSeconds: current.waitSeconds,
          ...(current.filter === undefined ? {} : { filter: current.filter }),
          sameProduct: current.sameProduct,
        },
        startedAtSeconds: elapsedSeconds,
        deadlineSeconds: result.deadlineSeconds,
        resolvedAtSeconds: result.resolvedAtSeconds,
        outcome: result.outcome,
        branch: result.outcome,
        matchedEventId: result.matchedEventId,
        checks: result.checks,
      });
      elapsedSeconds = result.resolvedAtSeconds;
      order += 1;
      current = nextNode(current.id, result.outcome);
      continue;
    }

    if (current.type === 'message') {
      // 与真实运行共用同一个替换函数，避免模拟结果和实际文案不一致。
      const nickname = scenario.user.displayName;
      const rawProductName = scenario.entryEvent.payload.productName;
      const productName = typeof rawProductName === 'string' ? rawProductName : null;
      const body = renderJourneyMessage({
        template: current.body,
        nickname,
        productName,
        field: 'body',
      });
      if (!body.ok) {
        throw new JourneySimulationMessageError(
          `「${current.name}」的消息内容替换后超过 ${body.maxLength} 字，请精简后重试`,
        );
      }
      let subject: string | null = null;
      if (current.subject !== null) {
        const renderedSubject = renderJourneyMessage({
          template: current.subject,
          nickname,
          productName,
          field: 'subject',
        });
        if (!renderedSubject.ok) {
          throw new JourneySimulationMessageError(
            `「${current.name}」的邮件主题替换后超过 ${renderedSubject.maxLength} 字，请精简后重试`,
          );
        }
        subject = renderedSubject.text;
      }
      steps.push({
        ...baseStep(current, order, elapsedSeconds),
        nodeType: 'message',
        channel: current.channel,
        subject,
        body: body.text,
      });
      order += 1;
      current = nextNode(current.id);
      continue;
    }

    steps.push({
      ...baseStep(current, order, elapsedSeconds),
      nodeType: 'end',
      note: current.note,
    });
    return {
      outcome: 'completed',
      user: publicUser,
      admission,
      steps,
      traversedEdgeIds,
      elapsedSeconds,
    };
  }
}
