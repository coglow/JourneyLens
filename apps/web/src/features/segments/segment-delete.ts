import type { ModalFuncProps } from 'antd';

/** 分群仍被旅程引用时的统一提示，列表和详情都据此禁用删除。 */
export const SEGMENT_IN_USE_MESSAGE = '该分群正在被旅程使用，请先更换或解除关联';

/** 打开分群删除确认；确认后的请求和页面后续动作由调用方负责。 */
export function confirmSegmentDeletion(
  confirm: (props: ModalFuncProps) => unknown,
  name: string,
  onConfirm: () => Promise<void>,
): void {
  confirm({
    title: '删除分群？',
    content: `确定删除“${name}”分群吗？删除后无法恢复。`,
    okText: '删除分群',
    cancelText: '保留分群',
    okButtonProps: { danger: true },
    onOk: onConfirm,
  });
}
