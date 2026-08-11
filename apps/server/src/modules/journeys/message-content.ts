import { renderJourneyMessage } from '@journeylens/shared';

/**
 * 按正文、邮件主题的顺序准备消息，保留原有超长反馈顺序。
 * 资料由调用方读取；这里只返回内容或原因，运行失败和试算反馈仍由各自流程处理。
 */
export function renderJourneyMessageContent(input: {
  nodeName: string;
  body: string;
  subject: string | null;
  nickname: string | null | undefined;
  productName: string | null | undefined;
}): { ok: true; body: string; subject: string | null } | { ok: false; reason: string } {
  const body = renderJourneyMessage({
    template: input.body,
    nickname: input.nickname,
    productName: input.productName,
    field: 'body',
  });
  if (!body.ok) {
    return {
      ok: false,
      reason: `「${input.nodeName}」的消息内容替换后超过 ${body.maxLength} 字，请精简后重试`,
    };
  }

  let subject: string | null = null;
  if (input.subject !== null) {
    const renderedSubject = renderJourneyMessage({
      template: input.subject,
      nickname: input.nickname,
      productName: input.productName,
      field: 'subject',
    });
    if (!renderedSubject.ok) {
      return {
        ok: false,
        reason: `「${input.nodeName}」的邮件主题替换后超过 ${renderedSubject.maxLength} 字，请精简后重试`,
      };
    }
    subject = renderedSubject.text;
  }

  return { ok: true, body: body.text, subject };
}
