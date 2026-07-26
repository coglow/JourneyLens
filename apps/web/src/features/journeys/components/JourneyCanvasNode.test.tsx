import { cleanup, render } from '@testing-library/react';
import { Position, type NodeProps } from '@xyflow/react';
import type * as ReactFlowModule from '@xyflow/react';
import { afterEach, expect, it, vi } from 'vitest';
import { JourneyCanvasNode, type JourneyCanvasFlowNode } from './JourneyCanvasNode';

const refreshHandles = vi.hoisted(() => vi.fn());
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactFlowModule>()),
  useUpdateNodeInternals: () => refreshHandles,
  Handle: ({ id, position }: { id: string; position: Position }) => (
    <span data-testid={id} data-position={position} />
  ),
}));

afterEach(() => {
  cleanup();
  refreshHandles.mockClear();
});

it('布局方向变化后刷新连接点测量，普通字段变化不重复测量', () => {
  const props: NodeProps<JourneyCanvasFlowNode> = {
    id: 'condition',
    type: 'journey',
    selected: false,
    dragging: false,
    isConnectable: true,
    selectable: true,
    deletable: true,
    draggable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      layoutDirection: 'vertical',
      draftNode: {
        id: 'condition',
        type: 'condition',
        name: '条件',
        position: { x: 0, y: 0 },
        rules: {
          kind: 'compare',
          left: { source: 'user', path: 'age' },
          operator: 'gt',
          right: 18,
        },
      },
    },
  };
  const view = render(<JourneyCanvasNode {...props} />);
  expect(refreshHandles).toHaveBeenCalledExactlyOnceWith('condition');
  expect(view.getByTestId('met').getAttribute('data-position')).toBe(Position.Left);

  props.data = { ...props.data, layoutDirection: 'horizontal' };
  view.rerender(<JourneyCanvasNode {...props} />);
  expect(refreshHandles).toHaveBeenCalledTimes(2);
  expect(view.getByTestId('met').getAttribute('data-position')).toBe(Position.Top);
  expect(view.getByTestId('unmet').getAttribute('data-position')).toBe(Position.Bottom);

  props.data = { ...props.data, draftNode: { ...props.data.draftNode, name: '修改名称' } };
  view.rerender(<JourneyCanvasNode {...props} />);
  expect(refreshHandles).toHaveBeenCalledTimes(2);
});

it('模拟经过的步骤带展示标记，文字与样式同时表达', () => {
  const props: NodeProps<JourneyCanvasFlowNode> = {
    id: 'wait',
    type: 'journey',
    selected: false,
    dragging: false,
    isConnectable: true,
    selectable: true,
    deletable: true,
    draggable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      layoutDirection: 'vertical',
      simulationState: 'traversed',
      draftNode: {
        id: 'wait',
        type: 'wait',
        name: '等待一分钟',
        position: { x: 0, y: 0 },
        waitSeconds: 60,
      },
    },
  };
  const view = render(<JourneyCanvasNode {...props} />);

  const article = view.getByLabelText('定时等待：等待一分钟，本次模拟经过');
  expect(article.getAttribute('data-simulation-state')).toBe('traversed');
});

it('行为等待节点提供等到行为与超时两个不同连接点', () => {
  const props: NodeProps<JourneyCanvasFlowNode> = {
    id: 'wait-event',
    type: 'journey',
    selected: false,
    dragging: false,
    isConnectable: true,
    selectable: true,
    deletable: true,
    draggable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      layoutDirection: 'vertical',
      draftNode: {
        id: 'wait-event',
        type: 'wait_for_event',
        name: '等购买',
        position: { x: 0, y: 0 },
        eventType: 'purchase_completed',
        waitSeconds: 3_600,
        sameProduct: true,
      },
    },
  };
  const view = render(<JourneyCanvasNode {...props} />);

  expect(view.getByTestId('matched').getAttribute('data-position')).toBe(Position.Left);
  expect(view.getByTestId('timeout').getAttribute('data-position')).toBe(Position.Right);
  expect(view.getByLabelText('等待行为：等购买')).toBeTruthy();
});
