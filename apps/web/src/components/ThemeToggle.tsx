import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';

type Props = { mode: 'light' | 'dark'; switching: boolean; onToggle: () => void };

export function ThemeToggle({ mode, switching, onToggle }: Props) {
  const label = mode === 'dark' ? '切换为浅色模式' : '切换为深色模式';
  return (
    <Tooltip title={label}>
      <Button
        type="text"
        htmlType="button"
        aria-label={label}
        disabled={switching}
        icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        onClick={onToggle}
      />
    </Tooltip>
  );
}
