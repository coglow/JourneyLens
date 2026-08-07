import { ThemeProvider } from '@/app/ThemeProvider';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Modal } from 'antd';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyDraftDefinition } from '@journeylens/shared';
import { JourneyAiDraftPage } from './JourneyAiDraftPage';
import { useJourneyAiDraft } from '@/features/journeys/hooks/useJourneyAiDraft';
import { generateJourneyAiDraft } from '@/services/journeys';
import { ApiError } from '@/services/api';

vi.mock('@/services/journeys', () => ({ generateJourneyAiDraft: vi.fn() }));

const generate = vi.mocked(generateJourneyAiDraft);

// 模型给出的候选不带坐标，界面按当前布局方向重新排版。
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
    {
      id: 'n2',
      type: 'message',
      name: '短信提醒',
      position: { x: 0, y: 0 },
      channel: 'sms',
      subject: null,
      body: '欢迎按需查看商品详情。',
    },
    { id: 'n3', type: 'end', name: '结束', position: { x: 0, y: 0 }, note: null },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
  ],
};

const onApply = vi.fn();
const onReadLatest = vi.fn();
const onClose = vi.fn();

// jsdom 缺少 React Flow 读取连接点时用到的矩阵对象。
beforeAll(() => {
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      readonly m22 = 1;
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  onApply.mockReset();
  onReadLatest.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  // Modal.confirm 挂载在独立容器上，cleanup 卸载不到，需要显式清掉。
  Modal.destroyAll();
  cleanup();
  localStorage.removeItem('journeylens-color-mode');
  delete document.documentElement.dataset.colorMode;
  document.documentElement.style.removeProperty('background-color');
  vi.clearAllMocks();
});

type RenderOptions = {
  hasExistingFlow?: boolean;
  unsavedChanges?: boolean;
  /** 画布有唯一合法开始行为时预填进入行为；空旅程保持未选择。 */
  prefillEntryBehavior?: boolean;
  mustVerify?: boolean;
  saveError?: string;
};

function renderPage({
  hasExistingFlow = false,
  unsavedChanges = false,
  prefillEntryBehavior = true,
  mustVerify = false,
  saveError,
}: RenderOptions = {}) {
  function Page() {
    const draft = useJourneyAiDraft({
      journeyId: 'journey-1',
      initialEntryBehavior: prefillEntryBehavior ? 'product_viewed' : undefined,
      onApply,
    });
    return (
      <JourneyAiDraftPage
        draft={draft}
        journeyName="商品浏览提醒"
        segmentName="高价值会员"
        layoutDirection="horizontal"
        hasExistingFlow={hasExistingFlow}
        unsavedChanges={unsavedChanges}
        mustVerify={mustVerify}
        saveError={saveError}
        blockReason={undefined}
        onReadLatest={async () => {
          await onReadLatest();
        }}
        onReturn={onClose}
      />
    );
  }
  render(
    <ThemeProvider>
      <Page />
    </ThemeProvider>,
  );
}

function typeDescription(value: string): void {
  fireEvent.change(screen.getByLabelText('旅程描述'), { target: { value } });
}

describe('AI 起草页面', () => {
  it('画布与清单切换不重新生成，点击节点可在侧栏查看正文', async () => {
    generate.mockResolvedValueOnce({ status: 'ready', draftDefinition: candidate });
    renderPage();
    typeDescription('浏览后提醒');
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));
    await screen.findByText(/流程检查通过/);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切换为深色模式' }));
    expect(document.querySelector('.react-flow')?.classList.contains('dark')).toBe(true);
    expect((screen.getByLabelText('旅程描述') as HTMLTextAreaElement).value).toBe('浏览后提醒');
    fireEvent.click(screen.getByLabelText('消息：短信提醒'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('欢迎按需查看商品详情。')).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('button', { name: /关闭|Close/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('radio', { name: '设置清单' }));
    fireEvent.click(await screen.findByRole('button', { name: '在画布中定位短信提醒' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('没有唯一开始行为时不默认选择，未选择不能提交', () => {
    renderPage({ prefillEntryBehavior: false });

    expect(
      screen.getByRole('button', { name: '入口人群：高价值会员（沿用当前设置）' }),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    const submit = screen.getByRole('button', { name: '生成方案' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    typeDescription('等待一小时内购买同一商品');
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('生成候选后展示选定进入行为与关键设置，应用时按当前布局方向排版', async () => {
    generate.mockResolvedValueOnce({ status: 'ready', draftDefinition: candidate });
    onApply.mockResolvedValueOnce({ status: 'applied' });
    renderPage({ hasExistingFlow: true, unsavedChanges: true });

    typeDescription('等待一小时内购买同一商品，超时提醒短信');
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));

    expect(await screen.findByText(/流程检查通过/)).toBeTruthy();
    expect(screen.queryByText('应用后将替换当前全部流程')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '设置清单' }));
    expect(await screen.findByText('欢迎按需查看商品详情。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '应用并保存草稿' }));
    expect(await screen.findByText(/本页尚未保存的修改也会一起被替换/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续核对' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '替换并保存' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '应用并保存草稿' }));
    fireEvent.click(await screen.findByRole('button', { name: '替换并保存' }));

    expect(await screen.findByText('已应用并保存草稿')).toBeTruthy();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0]?.[0] as JourneyDraftDefinition;
    expect(applied.layoutDirection).toBe('horizontal');
    const positions = applied.nodes.map((node) => `${node.position.x},${node.position.y}`);
    expect(new Set(positions).size).toBeGreaterThan(1);
  });

  it('需要补充时先展示两类问题，答完才提交并携带成对补答', async () => {
    generate.mockResolvedValueOnce({
      status: 'needs_input',
      questions: [
        { type: 'text', label: '最长等待多久？请带上单位。' },
        {
          type: 'single_choice',
          label: '使用哪种提醒方式？',
          options: [
            { value: 'sms', label: '短信' },
            { value: 'email', label: '邮件' },
          ],
        },
      ],
    });
    renderPage();

    typeDescription('等一段时间再提醒');
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));

    expect(await screen.findByText('问题 1：最长等待多久？请带上单位。')).toBeTruthy();
    const supplement = await screen.findByRole('button', { name: '补充并生成' });
    expect(supplement.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('最长等待多久？请带上单位。'), {
      target: { value: '1 小时' },
    });
    expect(supplement.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '短信' }));

    generate.mockResolvedValueOnce({ status: 'ready', draftDefinition: candidate });
    fireEvent.click(supplement);

    expect(await screen.findByText(/流程检查通过/)).toBeTruthy();
    expect(generate).toHaveBeenLastCalledWith('journey-1', {
      entryBehavior: 'product_viewed',
      description: '等一段时间再提醒',
      clarifications: [
        { question: { type: 'text', label: '最长等待多久？请带上单位。' }, answer: '1 小时' },
        {
          question: {
            type: 'single_choice',
            label: '使用哪种提醒方式？',
            options: [
              { value: 'sms', label: '短信' },
              { value: 'email', label: '邮件' },
            ],
          },
          answer: 'sms',
        },
      ],
    });
  });

  it('保存层要求核实时，修改描述仍保留错误和读取入口', async () => {
    renderPage({
      mustVerify: true,
      saveError: '本次保存结果未确认，请读取最新内容核实',
    });
    typeDescription('修改后的描述');
    expect(screen.getByText('本次保存结果未确认，请读取最新内容核实')).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成方案' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /^返回编排$/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));

    expect(onReadLatest).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('不支持的需求只说明原因，不提供应用按钮', async () => {
    generate.mockResolvedValueOnce({
      status: 'unsupported',
      reason: '当前平台不支持自动发放优惠券。',
    });
    renderPage();

    typeDescription('进入后立刻发放优惠券');
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));

    expect(await screen.findByText('当前平台不支持自动发放优惠券。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '应用并保存草稿' })).toBeNull();
  });

  it('生成被拒绝时说明哪一步需要调整，而不是只提示失败', async () => {
    generate.mockRejectedValueOnce(
      new ApiError(
        502,
        'AI_DRAFT_INVALID_OUTPUT',
        '本次方案未通过流程检查，请按提示调整描述后重新生成',
        { details: ['「短信订阅判断」：请选择“是”或“否”'] },
      ),
    );
    renderPage();

    typeDescription('短信订阅为是时发送短信');
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));

    expect(
      await screen.findByText('本次方案未通过流程检查，请按提示调整描述后重新生成'),
    ).toBeTruthy();
    expect(screen.getByText('「短信订阅判断」：请选择“是”或“否”')).toBeTruthy();
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy();
  });

  it('请求过于频繁时直接说明原因，不自行禁用生成', async () => {
    generate.mockRejectedValueOnce(
      new ApiError(429, 'AI_DRAFT_RATE_LIMITED', '起草请求过于频繁，请稍后再试'),
    );
    renderPage();

    typeDescription('等待一小时内购买同一商品');
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));

    expect(await screen.findByText('起草请求过于频繁，请稍后再试')).toBeTruthy();
    // 冷却由服务端判定，页面不再自行计时禁用按钮；再次点击仍交给服务端。
    expect(screen.getByRole('button', { name: '生成方案' }).hasAttribute('disabled')).toBe(false);
  });

  it('返回入口交给编辑工作区统一处理离开保护', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^返回编排$/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
