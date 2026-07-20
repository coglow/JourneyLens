import type { SegmentRule, SegmentRulePath } from '@journeylens/shared';

/** 按路径修改规则树；先复制整棵树，原状态及其所有子节点保持不变。 */
export function updateAtPath(
  root: SegmentRule,
  path: SegmentRulePath,
  update: (node: SegmentRule) => void,
): SegmentRule {
  const next = structuredClone(root);
  let node = next;
  // path 由编辑器按树结构生成：条件组对应 children 和序号，排除节点对应 child。
  for (let offset = 0; offset < path.length; offset += 1) {
    if (node.kind === 'not') {
      node = node.child;
    } else if (node.kind === 'all' || node.kind === 'any') {
      const index = path[offset + 1] as number;
      node = node.children[index]!;
      offset += 1;
    }
  }
  update(node);
  return next;
}

/** 删除路径指向的组内子项；路径最后一项是序号。 */
export function removeAtPath(root: SegmentRule, path: SegmentRulePath): SegmentRule {
  const index = path[path.length - 1] as number;
  const parentPath = path.slice(0, -2);
  return updateAtPath(root, parentPath, (parent) => {
    if (parent.kind === 'all' || parent.kind === 'any') {
      parent.children.splice(index, 1);
    }
  });
}

/** 规则树节点总数，包含条件组和排除节点自身。 */
export function countRuleNodes(rule: SegmentRule): number {
  if (rule.kind === 'compare') return 1;
  if (rule.kind === 'not') return 1 + countRuleNodes(rule.child);
  return 1 + rule.children.reduce((total, child) => total + countRuleNodes(child), 0);
}

/** 路径所在节点的层级，根节点为第 1 层；路径无效时返回 undefined。 */
export function ruleDepthAtPath(
  root: SegmentRule,
  path: readonly (string | number)[],
): number | undefined {
  let node = root;
  let depth = 1;
  for (let index = 0; index < path.length; index += 1) {
    const part = path[index];
    if (part === 'child' && node.kind === 'not') {
      node = node.child;
      depth += 1;
    } else if (part === 'children' && (node.kind === 'all' || node.kind === 'any')) {
      const childIndex = path[index + 1];
      if (typeof childIndex !== 'number') return undefined;
      const child = node.children[childIndex];
      if (child === undefined) return undefined;
      node = child;
      depth += 1;
      index += 1;
    } else {
      return undefined;
    }
  }
  return depth;
}

/** 规则节点对应的稳定 DOM 标识，用于滚动定位和焦点恢复。 */
export function rulePathId(path: readonly (string | number)[]): string {
  return path.length === 0 ? 'segment-rule-root' : `segment-rule-${path.join('-')}`;
}

/** 组内是否至少有一个条件；空组和只含空子组的组都没有可删除的内容。 */
export function containsCondition(rule: SegmentRule): boolean {
  if (rule.kind === 'compare') return true;
  if (rule.kind === 'not') return containsCondition(rule.child);
  return rule.children.some(containsCondition);
}
