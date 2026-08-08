import type { TableProps } from 'antd';

/**
 * 表格横向滚动宽度取列宽合计，避免增删列后手工维护的数字与列宽脱节。
 * 只适用于固定像素列宽的表格；列宽含百分比时不要使用，百分比列不参与合计。
 */
export function tableScrollX<RecordType>(
  columns: NonNullable<TableProps<RecordType>['columns']>,
): number {
  return columns.reduce(
    (total, column) => total + (typeof column.width === 'number' ? column.width : 0),
    0,
  );
}
