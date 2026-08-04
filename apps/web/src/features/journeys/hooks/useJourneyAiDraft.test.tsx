import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyAiDraftResult, JourneyDraftDefinition } from '@journeylens/shared';
import { ApiError } from '@/services/api';
import { generateJourneyAiDraft } from '@/services/journeys';
import { useJourneyAiDraft } from './useJourneyAiDraft';

vi.mock('@/services/journeys', () => ({ generateJourneyAiDraft: vi.fn() }));

const generate = vi.mocked(generateJourneyAiDraft);

const candidate: JourneyDraftDefinition = {
  layoutDirection: 'vertical',
  nodes: [
    {
      id: 'n1',
      type: 'start',
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'product_viewed',
    },
    { id: 'n2', type: 'end', name: '结束', position: { x: 0, y: 200 }, note: null },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
};

const needsInput: JourneyAiDraftResult = {
  status: 'needs_input',
  questions: [{ type: 'text', label: '最长等待多久？请带上单位。' }],
};

function setup() {
  return renderHook(() =>
    useJourneyAiDraft({
      journeyId: 'journey-1',
      initialEntryBehavior: undefined,
      onApply: async () => ({ status: 'applied' }),
    }),
  );
}

beforeEach(() => {
  generate.mockReset();
});

describe('useJourneyAiDraft', () => {
  it('未选择进入行为或描述为空时不提交', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.submit();
    });
    expect(generate).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: 'error', message: '请选择进入行为' });

    act(() => result.current.changeEntryBehavior('product_viewed'));
    await act(async () => {
      await result.current.submit();
    });
    expect(generate).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: 'error', message: '请填写旅程描述' });
  });

  it('补答完整后才提交，下一次请求携带全部问题与答案', async () => {
    generate.mockResolvedValueOnce(needsInput);
    const { result } = setup();
    act(() => result.current.changeEntryBehavior('product_viewed'));
    act(() => result.current.changeDescription('等待一小时内购买同一商品'));

    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state.status).toBe('needs_input');
    expect(result.current.questions).toHaveLength(1);

    // 漏答时不提交，也不消耗一次生成机会。
    await act(async () => {
      await result.current.submit();
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({
      status: 'error',
      message: '请填写全部补充信息后再生成',
    });

    generate.mockResolvedValueOnce({ status: 'ready', draftDefinition: candidate });
    act(() => result.current.answerPending(0, '1 小时'));
    await act(async () => {
      await result.current.submit();
    });

    expect(generate).toHaveBeenLastCalledWith('journey-1', {
      entryBehavior: 'product_viewed',
      description: '等待一小时内购买同一商品',
      clarifications: [{ question: needsInput.questions[0], answer: '1 小时' }],
    });
    expect(result.current.candidate).toEqual(candidate);
  });

  it('修改答案使候选失效但保留其他答案，修改描述清空全部补答', async () => {
    generate.mockResolvedValueOnce(needsInput);
    const { result } = setup();
    act(() => result.current.changeEntryBehavior('product_viewed'));
    act(() => result.current.changeDescription('等待购买后提醒'));
    await act(async () => {
      await result.current.submit();
    });
    generate.mockResolvedValueOnce({ status: 'ready', draftDefinition: candidate });
    act(() => result.current.answerPending(0, '1 小时'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.candidate).toEqual(candidate);

    act(() => result.current.changeClarificationAnswer(0, '2 小时'));
    expect(result.current.candidate).toBeUndefined();
    expect(result.current.clarifications).toEqual([
      { question: needsInput.questions[0], answer: '2 小时' },
    ]);

    act(() => result.current.changeDescription('换一个策略'));
    expect(result.current.clarifications).toEqual([]);
    expect(result.current.questions).toEqual([]);
  });

  it('模型继续提问时保留已回答内容，新问题追加', async () => {
    generate.mockResolvedValueOnce(needsInput);
    const { result } = setup();
    act(() => result.current.changeEntryBehavior('product_viewed'));
    act(() => result.current.changeDescription('等待购买后提醒'));
    await act(async () => {
      await result.current.submit();
    });

    generate.mockResolvedValueOnce({
      status: 'needs_input',
      questions: [{ type: 'text', label: '提醒文案写什么？' }],
    });
    act(() => result.current.answerPending(0, '1 小时'));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.clarifications).toEqual([
      { question: needsInput.questions[0], answer: '1 小时' },
    ]);
    expect(result.current.questions).toEqual([{ type: 'text', label: '提醒文案写什么？' }]);
    expect(result.current.answers).toEqual(['']);
  });

  it('生成失败时保留当前输入与补答', async () => {
    generate.mockResolvedValueOnce(needsInput);
    const { result } = setup();
    act(() => result.current.changeEntryBehavior('product_viewed'));
    act(() => result.current.changeDescription('等待购买后提醒'));
    await act(async () => {
      await result.current.submit();
    });

    generate.mockRejectedValueOnce(
      new ApiError(undefined, 'NETWORK_ERROR', '无法连接服务器，请稍后重试'),
    );
    act(() => result.current.answerPending(0, '1 小时'));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toEqual({
      status: 'error',
      message: '无法连接服务器，请稍后重试',
    });
    expect(result.current.description).toBe('等待购买后提醒');
    expect(result.current.clarifications).toEqual([
      { question: needsInput.questions[0], answer: '1 小时' },
    ]);
  });

  it('服务端限流时直接展示服务端文案，不自行禁用生成', async () => {
    generate.mockRejectedValueOnce(
      new ApiError(429, 'AI_DRAFT_RATE_LIMITED', '起草请求过于频繁，请稍后再试'),
    );
    const { result } = setup();
    act(() => result.current.changeEntryBehavior('product_viewed'));
    act(() => result.current.changeDescription('等待购买后提醒'));

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toMatchObject({
      status: 'error',
      message: '起草请求过于频繁，请稍后再试',
    });
    // 等待多久由服务端决定，前端不再自行计时禁用按钮。
    expect(result.current.pending).toBe(false);
  });

  it('修改输入后迟到的旧响应不再写回界面', async () => {
    let resolveFirst: ((value: JourneyAiDraftResult) => void) | undefined;
    generate.mockImplementationOnce(
      () =>
        new Promise<JourneyAiDraftResult>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = setup();
    act(() => result.current.changeEntryBehavior('product_viewed'));
    act(() => result.current.changeDescription('第一次描述'));

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.submit();
    });
    expect(result.current.state.status).toBe('pending');

    act(() => result.current.changeDescription('第二次描述'));
    expect(result.current.state.status).toBe('idle');

    await act(async () => {
      resolveFirst?.({ status: 'unsupported', reason: '旧结果' });
      await pending;
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.questions).toEqual([]);
  });

  it('打开窗口会重置上一次的内容，关闭后清空输入', async () => {
    const { result } = setup();
    act(() => result.current.changeEntryBehavior('product_viewed'));
    act(() => result.current.changeDescription('等待购买后提醒'));

    act(() => result.current.start('purchase_completed'));
    expect(result.current.entryBehavior).toBe('purchase_completed');
    expect(result.current.description).toBe('');
    expect(result.current.state.status).toBe('idle');

    act(() => result.current.clear());
    expect(result.current.entryBehavior).toBeUndefined();
  });
});
