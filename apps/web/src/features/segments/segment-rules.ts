import { getSegmentComparisonLabels, type SegmentRule } from '@journeylens/shared';

/** 列表摘要由共享属性目录生成，避免属性名称与规则编辑器不一致。 */
export function summarizeSegmentRule(rule: SegmentRule): string {
  return summarizeNode(rule, false);
}

function summarizeNode(rule: SegmentRule, nested: boolean): string {
  if (rule.kind === 'compare') {
    const { fieldLabel, operatorLabel, valueText } = getSegmentComparisonLabels(rule);
    const text =
      rule.operator === 'exists'
        ? `${fieldLabel} ${operatorLabel}`
        : `${fieldLabel} ${operatorLabel} ${valueText}`;
    // 组内条件逐项加括号；根节点只有一个条件时不加。
    return nested ? `（${text}）` : text;
  }

  if (rule.kind === 'not') {
    // “非（…）”本身已经界定了子规则范围，内部不再重复加括号。
    return `非（${summarizeNode(rule.child, false)}）`;
  }

  if (rule.children.length === 0) return '尚未添加条件';
  const separator = rule.kind === 'all' ? ' 且 ' : ' 或 ';
  const text = rule.children.map((child) => summarizeNode(child, true)).join(separator);
  // 嵌套组保留括号标明“且／或”的归属；根组不再整体加括号。
  return nested && rule.children.length > 1 ? `（${text}）` : text;
}
