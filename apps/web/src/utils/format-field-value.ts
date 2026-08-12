type FieldDefinition = {
  label: string;
  values?: readonly { value: string; label: string }[];
};

/** 统一字段取值的展示；缺失、空值、空列表分开表达，零和否保留各自含义。 */
export function formatFieldValue(value: unknown, field?: FieldDefinition): string {
  if (value === undefined) return '未提供';
  if (value === null) return '未填写';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    return value.length === 0
      ? '空列表'
      : value.map((item) => formatFieldValue(item, field)).join('、');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return field?.values?.find((option) => option.value === value)?.label ?? String(value);
}
