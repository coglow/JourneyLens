import {
  BaseEdge,
  Position,
  getSmoothStepPath,
  type BaseEdgeProps,
  type EdgeProps,
} from '@xyflow/react';

// 标签固定放在线离开出发节点的一端，多条线汇入同一节点时不会挤在同一条线上。
const LABEL_GAP = 36;

/** 沿出发方向把标签挪到节点外侧；不同出发点的标签位置必然不同。 */
function labelPosition(
  sourceX: number,
  sourceY: number,
  sourcePosition: Position,
): { x: number; y: number } {
  switch (sourcePosition) {
    case Position.Left:
      return { x: sourceX - LABEL_GAP, y: sourceY };
    case Position.Right:
      return { x: sourceX + LABEL_GAP, y: sourceY };
    case Position.Top:
      return { x: sourceX, y: sourceY - LABEL_GAP };
    default:
      return { x: sourceX, y: sourceY + LABEL_GAP };
  }
}

/** 旅程连线：路径仍由 smoothstep 生成，只调整标签位置。 */
export function JourneyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  pathOptions,
  interactionWidth,
  style,
  markerEnd,
  markerStart,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: pathOptions?.borderRadius,
    offset: pathOptions?.offset,
    stepPosition: pathOptions?.stepPosition,
  });

  const labelPoint = label ? labelPosition(sourceX, sourceY, sourcePosition) : null;

  // React Flow 把这条连线的展示属性原样传入，这里转交给 BaseEdge 以保持内置连线的外观；
  // 可选属性在 exactOptionalPropertyTypes 下不能显式传 undefined，因此整体断言为 BaseEdgeProps。
  const baseEdgeProps = {
    id,
    path,
    labelX: labelPoint?.x,
    labelY: labelPoint?.y,
    label,
    labelStyle,
    labelShowBg,
    labelBgStyle,
    labelBgPadding,
    labelBgBorderRadius,
    style,
    markerEnd,
    markerStart,
    interactionWidth,
  } as BaseEdgeProps;

  return <BaseEdge {...baseEdgeProps} />;
}
