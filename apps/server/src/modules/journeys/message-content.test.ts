import { describe, expect, it } from 'vitest';
import { renderJourneyMessageContent } from './message-content.js';

const message = {
  nodeName: '欢迎消息',
  body: '您好 {{用户昵称}}，欢迎查看 {{商品名称}}',
  subject: '{{用户昵称}}，看看 {{商品名称}}',
  nickname: '小陈',
  productName: '无线耳机',
};

describe('消息内容处理', () => {
  it('正文与主题使用同一份昵称和进入商品资料', () => {
    expect(renderJourneyMessageContent(message)).toEqual({
      ok: true,
      body: '您好 小陈，欢迎查看 无线耳机',
      subject: '小陈，看看 无线耳机',
    });
  });

  it('无主题时保留 null，缺失资料使用固定文字', () => {
    expect(
      renderJourneyMessageContent({ ...message, subject: null, nickname: null, productName: null }),
    ).toEqual({
      ok: true,
      body: '您好 顾客，欢迎查看 该商品',
      subject: null,
    });
  });

  it('正文与主题都不会再次解析资料中的变量标记', () => {
    expect(renderJourneyMessageContent({ ...message, nickname: '{{商品名称}}' })).toEqual({
      ok: true,
      body: '您好 {{商品名称}}，欢迎查看 无线耳机',
      subject: '{{商品名称}}，看看 无线耳机',
    });
  });

  it('正文正常而主题超长时返回主题的完整原因', () => {
    expect(
      renderJourneyMessageContent({
        ...message,
        subject: `${'a'.repeat(192)}{{商品名称}}`,
        productName: 'x'.repeat(180),
      }),
    ).toEqual({
      ok: false,
      reason: '「欢迎消息」的邮件主题替换后超过 200 字，请精简后重试',
    });
  });

  it.each([
    { name: '没有邮件主题', subject: null },
    { name: '邮件主题也超长', subject: `${'a'.repeat(192)}{{商品名称}}` },
  ])('$name 时优先返回正文超长的完整原因', ({ subject }) => {
    expect(
      renderJourneyMessageContent({
        ...message,
        body: `${'a'.repeat(1_992)}{{商品名称}}`,
        subject,
        productName: 'x'.repeat(180),
      }),
    ).toEqual({
      ok: false,
      reason: '「欢迎消息」的消息内容替换后超过 2000 字，请精简后重试',
    });
  });
});
