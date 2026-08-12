import { describe, expect, it } from 'vitest';
import { formatFieldValue } from './format-field-value';

describe('字段取值展示', () => {
  it.each([
    [undefined, '未提供'],
    [null, '未填写'],
    [[], '空列表'],
    [0, '0'],
    [false, '否'],
    [true, '是'],
    ['', ''],
  ])('区分缺失、空值、零和布尔值：%j', (value, expected) => {
    expect(formatFieldValue(value)).toBe(expected);
  });

  it('单值和列表都从字段目录取中文，未知值保留原文', () => {
    const field = {
      label: '会员等级',
      values: [
        { value: 'gold', label: '黄金' },
        { value: 'silver', label: '白银' },
      ],
    };
    expect(formatFieldValue('gold', field)).toBe('黄金');
    expect(formatFieldValue(['gold', 'silver'], field)).toBe('黄金、白银');
    expect(formatFieldValue('unknown', field)).toBe('unknown');
  });

  it('没有字段目录时保留普通文字、列表和对象内容', () => {
    expect(formatFieldValue('咖啡')).toBe('咖啡');
    expect(formatFieldValue(['咖啡', '阅读'])).toBe('咖啡、阅读');
    expect(formatFieldValue({ name: '咖啡' })).toBe('{"name":"咖啡"}');
  });
});
