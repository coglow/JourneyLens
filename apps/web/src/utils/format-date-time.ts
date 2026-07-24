export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

// 保存状态里的时间较短，只保留到分钟；时区固定为业务时区，避免同一页面在不同设备上显示不同。
const savedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatSavedAt(value: string): string {
  return savedAtFormatter.format(new Date(value));
}
