import { describe, expect, it } from 'vitest';
import type { TableProps } from 'antd';
import { tableScrollX } from './table-scroll';

type Columns = NonNullable<TableProps<{ id: string }>['columns']>;

describe('tableScrollX', () => {
  it('累加固定像素列宽', () => {
    const columns: Columns = [
      { key: 'a', width: 120 },
      { key: 'b', width: 80 },
    ];
    expect(tableScrollX(columns)).toBe(200);
  });

  it('跳过没有宽度和百分比宽度的列', () => {
    const columns: Columns = [{ key: 'a', width: 100 }, { key: 'b', width: '30%' }, { key: 'c' }];
    expect(tableScrollX(columns)).toBe(100);
  });

  it('没有列时返回 0', () => {
    expect(tableScrollX([])).toBe(0);
  });
});
