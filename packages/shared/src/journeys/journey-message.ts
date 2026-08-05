import { journeyEventField, type JourneyEventType } from './journey-events.js';
import {
  JOURNEY_MESSAGE_BODY_MAX_LENGTH,
  JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH,
} from './journey-limits.js';

/**
 * 本次只支持两个固定变量。
 * 标记同时用于界面插入、配置校验和运行替换，三处不能各写一套文字。
 */
export const JOURNEY_MESSAGE_NICKNAME_VARIABLE = '{{用户昵称}}';
export const JOURNEY_MESSAGE_PRODUCT_VARIABLE = '{{商品名称}}';

export const JOURNEY_MESSAGE_VARIABLES = [
  {
    marker: JOURNEY_MESSAGE_NICKNAME_VARIABLE,
    label: '用户昵称',
    description: '执行消息时的用户昵称',
    missingText: '顾客',
  },
  {
    marker: JOURNEY_MESSAGE_PRODUCT_VARIABLE,
    label: '商品名称',
    description: '进入旅程时的商品名称',
    missingText: '该商品',
  },
] as const;

export type JourneyMessageField = 'subject' | 'body';

/** 语法错误文案同时用于草稿校验和保存接口的错误反馈。 */
export const JOURNEY_MESSAGE_UNSUPPORTED_VARIABLE =
  '消息内容中有不支持的变量，请从“插入变量”中选择';
export const JOURNEY_MESSAGE_INCOMPLETE_VARIABLE = '消息内容中的变量没有写完整，请重新插入';

export function journeyMessageFieldLimit(field: JourneyMessageField): number {
  return field === 'subject' ? JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH : JOURNEY_MESSAGE_BODY_MAX_LENGTH;
}

export function journeyMessageFieldLabel(field: JourneyMessageField): string {
  return field === 'subject' ? '邮件主题' : '消息内容';
}

/** 保存接口据此只透出变量语法错误，不改变其他草稿错误的固定提示。 */
export function isJourneyMessageVariableError(message: string): boolean {
  return (
    message === JOURNEY_MESSAGE_UNSUPPORTED_VARIABLE ||
    message === JOURNEY_MESSAGE_INCOMPLETE_VARIABLE
  );
}

/**
 * 检查配置文本中的变量写法。
 * 双花括号是保留语法：未配对、嵌套或空变量按写法不完整处理；
 * 名称必须与固定变量完全一致，不支持额外空格和别名。
 */
export function checkJourneyMessageVariables(text: string): string | undefined {
  const knownNames = new Set(JOURNEY_MESSAGE_VARIABLES.map(({ marker }) => variableName(marker)));
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf('{{', index);
    const close = text.indexOf('}}', index);

    if (open === -1) {
      // 没有新的变量时，剩余的闭合标记同样属于写法不完整。
      return close === -1 ? undefined : JOURNEY_MESSAGE_INCOMPLETE_VARIABLE;
    }
    if (close !== -1 && close < open) return JOURNEY_MESSAGE_INCOMPLETE_VARIABLE;

    const end = text.indexOf('}}', open + 2);
    if (end === -1) return JOURNEY_MESSAGE_INCOMPLETE_VARIABLE;

    const name = text.slice(open + 2, end);
    if (name === '' || name.includes('{') || name.includes('}')) {
      return JOURNEY_MESSAGE_INCOMPLETE_VARIABLE;
    }
    if (!knownNames.has(name)) return JOURNEY_MESSAGE_UNSUPPORTED_VARIABLE;

    index = end + 2;
  }

  return undefined;
}

function variableName(marker: string): string {
  return marker.slice(2, -2);
}

/** 商品变量的来源是开始步骤的进入行为；与商品 ID 的能力判断保持一致。 */
export function journeyEntrySupportsProductName(entryBehavior: JourneyEventType): boolean {
  return journeyEventField(entryBehavior, 'productName') !== undefined;
}

export function journeyMessageUsesProductVariable(text: string | null | undefined): boolean {
  return text?.includes(JOURNEY_MESSAGE_PRODUCT_VARIABLE) === true;
}

export interface JourneyMessageRenderInput {
  template: string;
  nickname: string | null | undefined;
  productName: string | null | undefined;
  field: JourneyMessageField;
}

export type JourneyMessageRenderResult =
  { ok: true; text: string } | { ok: false; maxLength: number };

function fallbackValue(value: string | null | undefined, missingText: string): string {
  if (typeof value !== 'string') return missingText;
  const trimmed = value.trim();
  return trimmed === '' ? missingText : trimmed;
}

/** 一次扫描两个固定标记；替换值不会再次进入匹配。 */
const MESSAGE_PLACEHOLDER_PATTERN = new RegExp(
  JOURNEY_MESSAGE_VARIABLES.map(({ marker }) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(
    '|',
  ),
  'g',
);

/**
 * 替换消息内容并检查结果长度。
 * 只做一遍替换：昵称或商品名称里即使包含双花括号，也按资料文字展示，不再解析。
 */
export function renderJourneyMessage(input: JourneyMessageRenderInput): JourneyMessageRenderResult {
  const nickname = fallbackValue(input.nickname, JOURNEY_MESSAGE_VARIABLES[0].missingText);
  const productName = fallbackValue(input.productName, JOURNEY_MESSAGE_VARIABLES[1].missingText);
  const text = input.template.replace(MESSAGE_PLACEHOLDER_PATTERN, (marker) =>
    marker === JOURNEY_MESSAGE_NICKNAME_VARIABLE ? nickname : productName,
  );
  const maxLength = journeyMessageFieldLimit(input.field);
  return text.length <= maxLength ? { ok: true, text } : { ok: false, maxLength };
}
