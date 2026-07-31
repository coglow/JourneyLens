import type { AudienceField } from '../audience/audience-catalog.js';
import type { JourneyEventField } from './journey-events.js';

export type SimulationField = AudienceField | JourneyEventField;

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/**
 * 只校验字段目录已有的类型和范围，缺失及 null 都是合法的可选输入。
 * 模拟场景可任意留空，真实上报的必填标识由接收契约另外判断。
 */
export function validateFieldValue(field: SimulationField, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;

  if (field.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${field.label}必须是数字`;
    if (field.minimum !== undefined && value < field.minimum) {
      return `${field.label}不能小于 ${field.minimum}`;
    }
    if (field.precision === 0 && !Number.isSafeInteger(value)) {
      return `${field.label}必须是整数`;
    }
    if (field.precision === 2 && !hasAtMostTwoDecimals(value)) {
      return `${field.label}最多保留两位小数`;
    }
    return undefined;
  }

  if (field.kind === 'boolean') {
    return typeof value === 'boolean' ? undefined : `${field.label}必须选择是或否`;
  }

  if (field.kind === 'string[]') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return `${field.label}格式不正确`;
    }
    if (field.values !== undefined) {
      const allowed = new Set(field.values.map((item) => item.value));
      if (value.some((item) => !allowed.has(item))) return `${field.label}包含未提供的选项`;
    }
    return undefined;
  }

  if (typeof value !== 'string') return `${field.label}必须是文字`;
  const maxLength = 'maxLength' in field ? field.maxLength : undefined;
  if (maxLength !== undefined && value.length > maxLength) {
    return `${field.label}最多 ${maxLength} 个字符`;
  }
  if (field.values !== undefined && !field.values.some((item) => item.value === value)) {
    return `请选择有效的${field.label}`;
  }
  return undefined;
}
