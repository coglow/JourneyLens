import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

afterEach(cleanup);

describe('PageHeader', () => {
  it('标题渲染为页面唯一标题', () => {
    render(<PageHeader title="全部活动" />);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: '全部活动' })).toBeTruthy();
  });

  it('back 渲染在标题上方，actions 渲染在页头内', () => {
    const { container } = render(
      <PageHeader
        title="春季活动"
        back={<button type="button">返回活动列表</button>}
        actions={<button type="button">编辑活动</button>}
      />,
    );
    const heading = screen.getByRole('heading', { level: 2, name: '春季活动' });
    const pageHeader = container.firstElementChild;
    const back = screen.getByRole('button', { name: '返回活动列表' });
    const actions = screen.getByRole('button', { name: '编辑活动' });

    expect(pageHeader).not.toBeNull();
    expect(pageHeader?.contains(back)).toBe(true);
    expect(pageHeader?.contains(actions)).toBe(true);
    expect(heading.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_PRECEDING).not.toBe(0);
  });

  it('未提供可选槽位时不渲染操作区', () => {
    render(<PageHeader title="全部活动" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
