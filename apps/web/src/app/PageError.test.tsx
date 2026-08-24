import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageError } from './PageError';

const reload = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  cleanup();
  reload.mockClear();
});

describe('PageError', () => {
  it('显示中文说明和恢复按钮', () => {
    render(<PageError />);
    expect(screen.getByText('页面暂时无法打开')).toBeTruthy();
    expect(screen.getByText('请重新加载页面再试一次')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新加载页面' })).toBeTruthy();
  });

  it('点击恢复按钮重新加载页面', () => {
    render(<PageError />);
    fireEvent.click(screen.getByRole('button', { name: '重新加载页面' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
