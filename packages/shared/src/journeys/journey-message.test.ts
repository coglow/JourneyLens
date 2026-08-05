import { describe, expect, it } from 'vitest';
import {
  JOURNEY_MESSAGE_BODY_MAX_LENGTH,
  JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH,
} from './journey-limits.js';
import {
  JOURNEY_MESSAGE_INCOMPLETE_VARIABLE,
  JOURNEY_MESSAGE_UNSUPPORTED_VARIABLE,
  checkJourneyMessageVariables,
  journeyEntrySupportsProductName,
  journeyMessageUsesProductVariable,
  renderJourneyMessage,
} from './journey-message.js';

describe('消息变量替换', () => {
  it('替换昵称和商品名称，并支持重复出现', () => {
    const result = renderJourneyMessage({
      template: '您好，{{用户昵称}}，欢迎查看 {{商品名称}}。{{用户昵称}}',
      nickname: ' 小陈 ',
      productName: ' 无线耳机 ',
      field: 'body',
    });

    expect(result).toEqual({ ok: true, text: '您好，小陈，欢迎查看 无线耳机。小陈' });
  });

  it('资料缺失、空字符串或只有空白时使用固定文字', () => {
    expect(
      renderJourneyMessage({
        template: '{{用户昵称}}/{{商品名称}}',
        nickname: null,
        productName: undefined,
        field: 'body',
      }),
    ).toEqual({ ok: true, text: '顾客/该商品' });

    expect(
      renderJourneyMessage({
        template: '{{用户昵称}}/{{商品名称}}',
        nickname: '   ',
        productName: '',
        field: 'body',
      }),
    ).toEqual({ ok: true, text: '顾客/该商品' });
  });

  it('只替换一遍，资料里的双花括号按原文展示', () => {
    expect(
      renderJourneyMessage({
        template: '{{用户昵称}}',
        nickname: '{{商品名称}}',
        productName: '无线耳机',
        field: 'body',
      }),
    ).toEqual({ ok: true, text: '{{商品名称}}' });
  });

  it('资料里的替换符号按普通文字插入', () => {
    expect(
      renderJourneyMessage({
        template: '{{用户昵称}}',
        nickname: "$& $` $'",
        productName: null,
        field: 'body',
      }),
    ).toEqual({ ok: true, text: "$& $` $'" });
  });

  it('正文和邮件主题分别按各自上限检查结果长度', () => {
    const bodyTemplate = `${'a'.repeat(JOURNEY_MESSAGE_BODY_MAX_LENGTH - 8)}{{商品名称}}`;
    const body = renderJourneyMessage({
      template: bodyTemplate,
      nickname: null,
      productName: 'x'.repeat(180),
      field: 'body',
    });
    expect(body).toEqual({ ok: false, maxLength: JOURNEY_MESSAGE_BODY_MAX_LENGTH });

    const subjectTemplate = `${'a'.repeat(JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH - 8)}{{用户昵称}}`;
    expect(
      renderJourneyMessage({
        template: subjectTemplate,
        nickname: '小陈',
        productName: null,
        field: 'subject',
      }).ok,
    ).toBe(true);
    expect(
      renderJourneyMessage({
        template: subjectTemplate,
        nickname: 'x'.repeat(120),
        productName: null,
        field: 'subject',
      }),
    ).toEqual({ ok: false, maxLength: JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH });
  });
});

describe('消息变量语法', () => {
  it('普通文字、单花括号和完整变量都可以保存', () => {
    expect(checkJourneyMessageVariables('您好，欢迎查看商品')).toBeUndefined();
    expect(checkJourneyMessageVariables('单花括号 {顾客} 按文字保留')).toBeUndefined();
    expect(checkJourneyMessageVariables('{{用户昵称}}，欢迎查看 {{商品名称}}')).toBeUndefined();
  });

  it('未知名称和额外空格不被接受', () => {
    expect(checkJourneyMessageVariables('{{游客昵称}}')).toBe(JOURNEY_MESSAGE_UNSUPPORTED_VARIABLE);
    expect(checkJourneyMessageVariables('{{ 用户昵称 }}')).toBe(
      JOURNEY_MESSAGE_UNSUPPORTED_VARIABLE,
    );
  });

  it('空变量、未配对和嵌套标记按写法不完整处理', () => {
    for (const text of [
      '{{}}',
      '{{用户昵称}',
      '{{用户昵称}}}}',
      '{{{{用户昵称}}}}',
      'a}}b',
      '{{用户{{昵称}}}}',
    ]) {
      expect(checkJourneyMessageVariables(text), text).toBe(JOURNEY_MESSAGE_INCOMPLETE_VARIABLE);
    }
  });
});

describe('商品变量可用范围', () => {
  it('只有带商品名称的进入行为可用', () => {
    expect(journeyEntrySupportsProductName('product_viewed')).toBe(true);
    expect(journeyEntrySupportsProductName('purchase_completed')).toBe(true);
    expect(journeyEntrySupportsProductName('reservation_created')).toBe(true);
    expect(journeyEntrySupportsProductName('app_session_started')).toBe(false);
    expect(journeyEntrySupportsProductName('app_exit')).toBe(false);
    expect(journeyEntrySupportsProductName('registration_completed')).toBe(false);
    expect(journeyEntrySupportsProductName('subscription_started')).toBe(false);
  });

  it('识别正文或主题是否引用了商品变量', () => {
    expect(journeyMessageUsesProductVariable('您好 {{商品名称}}')).toBe(true);
    expect(journeyMessageUsesProductVariable('您好 {{用户昵称}}')).toBe(false);
    expect(journeyMessageUsesProductVariable(null)).toBe(false);
  });
});
