import type { ReactNode } from 'react';
import {
  BranchesOutlined,
  ClockCircleOutlined,
  FlagOutlined,
  FieldTimeOutlined,
  MessageOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { JourneyNodeType } from '@journeylens/shared';

/** 步骤类型短名称：版本页的步骤详情与运行统计表共用一份，避免两处叫法不一致。 */
export const journeyNodeTypeLabels: Record<JourneyNodeType, string> = {
  start: '开始',
  condition: '条件分支',
  wait: '定时等待',
  wait_for_event: '等待行为',
  message: '消息',
  end: '结束',
};

/** 两个新增入口共用固定步骤名称、说明和图标，避免菜单与左侧列表分叉。 */
export const journeyNodeOptions: Array<{
  label: string;
  value: JourneyNodeType;
  description: string;
  icon: ReactNode;
}> = [
  { label: '开始旅程', value: 'start', description: '设置进入行为', icon: <ThunderboltOutlined /> },
  {
    label: '条件分支',
    value: 'condition',
    description: '按用户属性拆分路径',
    icon: <BranchesOutlined />,
  },
  {
    label: '定时等待',
    value: 'wait',
    description: '延迟一段时间后继续',
    icon: <ClockCircleOutlined />,
  },
  {
    label: '等待行为',
    value: 'wait_for_event',
    description: '等到指定行为或超时后继续',
    icon: <FieldTimeOutlined />,
  },
  {
    label: '消息',
    value: 'message',
    description: '配置短信、推送或邮件',
    icon: <MessageOutlined />,
  },
  { label: '结束旅程', value: 'end', description: '结束当前路径', icon: <FlagOutlined /> },
];
