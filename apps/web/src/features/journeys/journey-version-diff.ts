import {
  JOURNEY_BRANCH_LABELS,
  type JourneyDraftEdge,
  type JourneyDraftNode,
  type JourneyNodeType,
  type JourneyVersionSnapshot,
} from '@journeylens/shared';
import { journeyNodeDetails, type JourneyNodeDetailItem } from './journey-node-details';

type SegmentSnapshot = NonNullable<JourneyVersionSnapshot['entrySegment']>;

export type JourneyVersionDiffGroup =
  'meta' | 'segment' | 'node-added' | 'node-removed' | 'node-updated' | 'edge';

export const JOURNEY_VERSION_DIFF_GROUP_LABELS: Record<JourneyVersionDiffGroup, string> = {
  meta: '名称与说明',
  segment: '入口人群',
  'node-added': '新增步骤',
  'node-removed': '移除步骤',
  'node-updated': '修改步骤',
  edge: '连线调整',
};

export type JourneyVersionDiffRow = {
  label: string;
  before: string;
  after: string;
  marked: boolean;
};

type MetaItem = {
  group: 'meta';
  key: string;
  title: string;
  before: string;
  after: string;
};

type SegmentItem = {
  group: 'segment';
  key: string;
  title: string;
  showRules: boolean;
  before: SegmentSnapshot | null;
  after: SegmentSnapshot | null;
};

type NodeAddedItem = {
  group: 'node-added';
  key: string;
  title: string;
  nodeType: JourneyNodeType;
  details: JourneyNodeDetailItem[];
};

type NodeRemovedItem = {
  group: 'node-removed';
  key: string;
  title: string;
  nodeType: JourneyNodeType;
  details: JourneyNodeDetailItem[];
};

type NodeUpdatedItem = {
  group: 'node-updated';
  key: string;
  title: string;
  nodeType: JourneyNodeType;
  details: JourneyVersionDiffRow[];
  textOnly: boolean;
};

type EdgeItem = {
  group: 'edge';
  key: string;
  title: string;
  added: boolean;
};

export type JourneyVersionDiffItem =
  MetaItem | SegmentItem | NodeAddedItem | NodeRemovedItem | NodeUpdatedItem | EdgeItem;

/**
 * 结构比较：不依赖 JSON 字符串的键顺序，也不把 undefined 与缺失字段混为一谈。
 */
function isSameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => isSameValue(item, right[index]));
  }
  if (typeof left === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    if (leftKeys.length !== Object.keys(rightRecord).length) return false;
    return leftKeys.every(
      (key) => key in rightRecord && isSameValue(leftRecord[key], rightRecord[key]),
    );
  }
  return false;
}

/**
 * 参与判定的业务字段。判定看原始值而不是展示文案，
 * 因为“结束说明为空”和“结束说明写成未填写”显示出来完全一样。
 */
function nodeComparableFields(node: JourneyDraftNode): Record<string, unknown> {
  switch (node.type) {
    case 'start':
      return { name: node.name, entryBehavior: node.entryBehavior };
    case 'condition':
      return { name: node.name, rules: node.rules };
    case 'wait':
      return { name: node.name, waitSeconds: node.waitSeconds };
    case 'wait_for_event':
      return {
        name: node.name,
        eventType: node.eventType,
        waitSeconds: node.waitSeconds,
        filter: node.filter,
        sameProduct: node.sameProduct,
      };
    case 'message':
      return {
        name: node.name,
        channel: node.channel,
        subject: node.subject,
        body: node.body,
      };
    case 'end':
      return { name: node.name, note: node.note };
  }
}

function toValueMap(details: JourneyNodeDetailItem[]): Map<string, string> {
  return new Map(details.map((item) => [item.label, item.value]));
}

/** 两版配置按标签对齐，只为阅读方便，不承担判定作用。 */
function alignDetails(
  before: JourneyNodeDetailItem[],
  after: JourneyNodeDetailItem[],
): JourneyVersionDiffRow[] {
  const beforeValues = toValueMap(before);
  const afterValues = toValueMap(after);
  const labels = [...new Set([...beforeValues.keys(), ...afterValues.keys()])];
  return labels.map((label) => {
    const beforeValue = beforeValues.get(label) ?? '';
    const afterValue = afterValues.get(label) ?? '';
    return { label, before: beforeValue, after: afterValue, marked: beforeValue !== afterValue };
  });
}

function diffNode(before: JourneyDraftNode, after: JourneyDraftNode): NodeUpdatedItem | null {
  const beforeFields = nodeComparableFields(before);
  const afterFields = nodeComparableFields(after);
  const changed = Object.keys(beforeFields).some(
    (key) => !isSameValue(beforeFields[key], afterFields[key]),
  );
  if (!changed) return null;

  const rows = alignDetails(journeyNodeDetails(before), journeyNodeDetails(after));
  const details =
    before.name === after.name
      ? rows
      : [{ label: '步骤名称', before: before.name, after: after.name, marked: true }, ...rows];

  return {
    group: 'node-updated',
    key: `node-updated-${after.id}`,
    title:
      before.name === after.name ? `「${after.name}」` : `「${before.name}」→「${after.name}」`,
    nodeType: after.type,
    details,
    textOnly: !details.some((row) => row.marked),
  };
}

function diffSegment(
  before: SegmentSnapshot | null,
  after: SegmentSnapshot | null,
): SegmentItem | null {
  if (before === null && after === null) return null;
  if (before === null && after !== null) {
    return {
      group: 'segment',
      key: 'segment',
      title: `从不限人群改为「${after.name}」`,
      showRules: true,
      before: null,
      after,
    };
  }
  if (before !== null && after === null) {
    return {
      group: 'segment',
      key: 'segment',
      title: `从「${before.name}」改为不限人群`,
      showRules: true,
      before,
      after: null,
    };
  }
  if (before === null || after === null) return null;

  // 分群规则按结构严格比较，不做逻辑等价推理。
  const sameRules = isSameValue(before.rules, after.rules);
  if (before.id !== after.id) {
    return {
      group: 'segment',
      key: 'segment',
      title: `入口人群从「${before.name}」改为「${after.name}」${
        sameRules ? '，分群规则相同' : '，分群规则已调整'
      }`,
      showRules: !sameRules,
      before,
      after,
    };
  }
  if (!sameRules) {
    return {
      group: 'segment',
      key: 'segment',
      title: '入口人群规则已调整',
      showRules: true,
      before,
      after,
    };
  }
  // 同一个分群只改了名称时成员范围没变，不列为变更，避免噪音。
  return null;
}

function edgeText(edge: JourneyDraftEdge, names: Map<string, string>): string {
  const source = names.get(edge.source) ?? '已移除的步骤';
  const target = names.get(edge.target) ?? '已移除的步骤';
  const branch = edge.branch === undefined ? '' : `（${JOURNEY_BRANCH_LABELS[edge.branch]}）`;
  return `${source} → ${target}${branch}`;
}

function edgeKey(edge: JourneyDraftEdge): string {
  return JSON.stringify([edge.source, edge.target, edge.branch ?? null]);
}

export function diffJourneyVersions(
  before: JourneyVersionSnapshot,
  after: JourneyVersionSnapshot,
): JourneyVersionDiffItem[] {
  const items: JourneyVersionDiffItem[] = [];

  if (before.name !== after.name) {
    items.push({
      group: 'meta',
      key: 'meta-name',
      title: '旅程名称',
      before: before.name,
      after: after.name,
    });
  }
  if (!isSameValue(before.description, after.description)) {
    items.push({
      group: 'meta',
      key: 'meta-description',
      title: '旅程说明',
      before: before.description ?? '未填写',
      after: after.description ?? '未填写',
    });
  }

  const segment = diffSegment(before.entrySegment, after.entrySegment);
  if (segment !== null) items.push(segment);

  const beforeNodes = new Map(before.definition.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.definition.nodes.map((node) => [node.id, node]));

  // 同 id 但类型不同的节点按“新增 + 移除”处理，不做字段对齐。
  for (const node of after.definition.nodes) {
    const previous = beforeNodes.get(node.id);
    if (previous !== undefined && previous.type === node.type) continue;
    items.push({
      group: 'node-added',
      key: `node-added-${node.id}`,
      title: `「${node.name}」`,
      nodeType: node.type,
      details: journeyNodeDetails(node),
    });
  }

  for (const node of before.definition.nodes) {
    const next = afterNodes.get(node.id);
    if (next !== undefined && next.type === node.type) continue;
    items.push({
      group: 'node-removed',
      key: `node-removed-${node.id}`,
      title: `「${node.name}」`,
      nodeType: node.type,
      details: journeyNodeDetails(node),
    });
  }

  for (const node of after.definition.nodes) {
    const previous = beforeNodes.get(node.id);
    if (previous === undefined || previous.type !== node.type) continue;
    const update = diffNode(previous, node);
    if (update !== null) items.push(update);
  }

  // 两版各用自己的步骤名称：步骤改名后，被移除的旧连接仍应显示改名前叫法。
  const beforeNames = new Map(before.definition.nodes.map((node) => [node.id, node.name]));
  const afterNames = new Map(after.definition.nodes.map((node) => [node.id, node.name]));

  const beforeEdges = new Map(
    before.definition.edges.map((edge) => [edgeKey(edge), edge] as const),
  );
  const afterEdges = new Map(after.definition.edges.map((edge) => [edgeKey(edge), edge] as const));

  for (const [key, edge] of afterEdges) {
    if (beforeEdges.has(key)) continue;
    items.push({
      group: 'edge',
      key: `edge-added-${key}`,
      title: edgeText(edge, afterNames),
      added: true,
    });
  }

  for (const [key, edge] of beforeEdges) {
    if (afterEdges.has(key)) continue;
    items.push({
      group: 'edge',
      key: `edge-removed-${key}`,
      title: edgeText(edge, beforeNames),
      added: false,
    });
  }

  return items;
}
