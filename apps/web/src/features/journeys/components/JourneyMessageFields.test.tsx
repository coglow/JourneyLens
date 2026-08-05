import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JourneyDraftNode } from '@journeylens/shared';
import { JourneyMessageFields } from './JourneyMessageFields';

afterEach(cleanup);

function messageNode(overrides: Partial<Extract<JourneyDraftNode, { type: 'message' }>> = {}) {
  return {
    id: 'n-message',
    type: 'message' as const,
    name: '欢迎消息',
    position: { x: 0, y: 0 },
    channel: 'sms' as const,
    subject: null,
    body: '您好，',
    ...overrides,
  };
}

function renderFields(
  options: {
    node?: ReturnType<typeof messageNode>;
    startBehavior?: 'product_viewed' | 'registration_completed';
    hasUniqueStart?: boolean;
    bodyError?: string;
  } = {},
) {
  const onChange = vi.fn();
  const view = render(
    <JourneyMessageFields
      node={options.node ?? messageNode()}
      disabled={false}
      onChange={onChange}
      startBehavior={options.startBehavior ?? 'product_viewed'}
      hasUniqueStart={options.hasUniqueStart ?? true}
      subjectError={undefined}
      bodyError={options.bodyError}
    />,
  );
  return { ...view, onChange };
}

async function openBodyVariableMenu() {
  fireEvent.click(screen.getByRole('button', { name: '向消息内容插入变量' }));
  return screen.findByText('用户昵称（执行消息时的用户昵称）');
}

describe('消息变量插入', () => {
  it('在光标位置插入变量，并交出插入后的完整内容', async () => {
    const { onChange } = renderFields({ node: messageNode({ body: '您好，欢迎' }) });
    const textarea = screen.getByLabelText('消息内容') as HTMLTextAreaElement;
    textarea.setSelectionRange(3, 3);
    fireEvent.select(textarea);

    fireEvent.click(await openBodyVariableMenu());
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ body: '您好，{{用户昵称}}欢迎' }),
    );
  });

  it('商品变量在进入行为不支持商品时不可插入，并说明原因', async () => {
    const { onChange } = renderFields({ startBehavior: 'registration_completed' });
    await openBodyVariableMenu();

    const productItem = screen.getByText('商品名称（当前进入行为没有商品信息）');
    expect(productItem.closest('li')?.className).toContain('disabled');
    fireEvent.click(productItem);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('插入后会超过上限时保留原文并提示', async () => {
    const { onChange } = renderFields({ node: messageNode({ body: 'a'.repeat(2_000) }) });

    fireEvent.click(await openBodyVariableMenu());
    expect(screen.getByText('插入后消息内容超过 2000 字，请先精简')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('展示共享校验给出的字段错误', () => {
    renderFields({ bodyError: '消息内容中有不支持的变量，请从“插入变量”中选择' });
    expect(screen.getByText('消息内容中有不支持的变量，请从“插入变量”中选择')).toBeTruthy();
  });
});
