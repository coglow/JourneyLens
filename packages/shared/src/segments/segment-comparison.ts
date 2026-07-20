import {
  COMPARISON_OPERATOR_LABELS,
  audienceField,
  audienceValueLabel,
} from '../audience/audience-catalog.js';
import type { SegmentRuleCompare } from './segment-rule.js';

export interface SegmentComparisonLabels {
  fieldLabel: string;
  operatorLabel: string;
  valueText: string;
}

/**
 * 单个比较条件的展示文案：字段名、操作符名和比较值都来自属性目录。
 * 调用方自行决定括号、取反和分组措辞，这里只提供基础片段。
 */
export function getSegmentComparisonLabels(rule: SegmentRuleCompare): SegmentComparisonLabels {
  const field = audienceField(rule.left.path);
  const values =
    rule.right === undefined ? [] : Array.isArray(rule.right) ? rule.right : [rule.right];

  return {
    fieldLabel: field?.label ?? rule.left.path,
    operatorLabel: COMPARISON_OPERATOR_LABELS[rule.operator],
    valueText: values.map((value) => audienceValueLabel(field, value)).join('、'),
  };
}
