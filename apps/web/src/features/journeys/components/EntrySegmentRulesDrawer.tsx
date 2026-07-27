import { Drawer, Flex, Typography } from 'antd';
import type { SegmentRule } from '@journeylens/shared';
import { SegmentRuleView } from '@/features/segments/components/SegmentRuleView';

type Props = {
  open: boolean;
  title: string;
  name: string;
  rules: SegmentRule;
  onClose: () => void;
};

export function EntrySegmentRulesDrawer({ open, title, name, rules, onClose }: Props) {
  return (
    <Drawer title={title} open={open} onClose={onClose} size={560}>
      <Flex vertical gap={20}>
        <Typography.Text strong>{name}</Typography.Text>
        <SegmentRuleView rules={rules} />
      </Flex>
    </Drawer>
  );
}
