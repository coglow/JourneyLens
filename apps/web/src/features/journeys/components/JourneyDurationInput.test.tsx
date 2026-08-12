import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JourneyDurationInput } from './JourneyDurationInput';

afterEach(cleanup);

function Harness({ initialSeconds }: { initialSeconds: number }) {
  const [seconds, setSeconds] = useState(initialSeconds);
  return (
    <>
      <JourneyDurationInput
        label="等待时长"
        seconds={seconds}
        min={1}
        onChange={(next) => setSeconds(next ?? 0)}
      />
      <output data-testid="seconds">{seconds}</output>
    </>
  );
}

function durationInput(): HTMLInputElement {
  return screen.getByRole('spinbutton', { name: '等待时长数值' }) as HTMLInputElement;
}

describe('时长输入', () => {
  it('秒数被外部改成更小的时长时，单位跟着回退，不显示成 0', () => {
    const { rerender } = render(
      <JourneyDurationInput label="等待时长" seconds={86_400} min={1} onChange={vi.fn()} />,
    );
    expect(durationInput().value).toBe('1');
    expect(screen.getByText('天')).toBeTruthy();

    rerender(<JourneyDurationInput label="等待时长" seconds={3_600} min={1} onChange={vi.fn()} />);

    expect(durationInput().value).toBe('1');
    expect(screen.getByText('小时')).toBeTruthy();
    expect(screen.queryByText('天')).toBeNull();
  });

  it('切换单位时数字不变，按新单位换算成秒保存', () => {
    render(<Harness initialSeconds={172_800} />);
    expect(durationInput().value).toBe('2');
    expect(screen.getByText('天')).toBeTruthy();

    fireEvent.mouseDown(screen.getByLabelText('等待时长单位'));
    fireEvent.click(screen.getByText('分钟', { selector: '.ant-select-item-option-content' }));
    expect(durationInput().value).toBe('2');
    expect(screen.getByTestId('seconds').textContent).toBe('120');

    fireEvent.mouseDown(screen.getByLabelText('等待时长单位'));
    fireEvent.click(screen.getByText('小时', { selector: '.ant-select-item-option-content' }));
    expect(durationInput().value).toBe('2');
    expect(screen.getByTestId('seconds').textContent).toBe('7200');
  });
});
