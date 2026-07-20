import { Modal } from 'antd';

/** 打开分群删除确认；确认后的请求和页面后续动作由调用方负责。 */
export function confirmSegmentDeletion(name: string, onConfirm: () => Promise<void>): void {
  Modal.confirm({
    title: '删除分群？',
    content: `确定删除“${name}”吗？删除后无法恢复。`,
    okText: '删除分群',
    cancelText: '保留分群',
    okButtonProps: { danger: true },
    onOk: onConfirm,
  });
}
