import { Button, Flex } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { SegmentRuleCompare, SegmentRule, SegmentRulePath } from '@journeylens/shared';
import { removeAtPath, rulePathId, updateAtPath } from '@/features/segments/segment-rule-tree';
import { RuleCompareFields } from '@/components/RuleCompareFields';
import styles from './RuleTreeEditor.module.css';

type RuleCompareEditorProps = {
  value: SegmentRuleCompare;
  treeRoot: SegmentRule;
  path: SegmentRulePath;
  label: string;
  conflicted: boolean;
  canRemove: boolean;
  onChange: (value: SegmentRule) => void;
};

/** 规则树中的单个比较条件：共用比较字段，额外提供定位标识、冲突高亮和删除入口。 */
export function RuleCompareEditor({
  value,
  treeRoot,
  path,
  label,
  conflicted,
  canRemove,
  onChange,
}: RuleCompareEditorProps) {
  const updateCompare = (next: SegmentRuleCompare) =>
    onChange(
      updateAtPath(treeRoot, path, (node) => {
        if (node.kind !== 'compare') return;
        // 整体替换前先移除可选的比较值，避免用户清空后残留旧值。
        delete node.right;
        Object.assign(node, next);
      }),
    );

  return (
    <div
      id={rulePathId(path)}
      tabIndex={-1}
      className={`${styles.condition} ${conflicted ? styles.conflicted : ''}`}
    >
      <Flex align="center" gap={8}>
        <RuleCompareFields value={value} label={label} onChange={updateCompare} />
        {canRemove && (
          <Button
            aria-label={`删除${label}`}
            icon={<DeleteOutlined />}
            type="text"
            danger
            style={{ flex: 'none' }}
            onClick={() => onChange(removeAtPath(treeRoot, path))}
          />
        )}
      </Flex>
    </div>
  );
}
