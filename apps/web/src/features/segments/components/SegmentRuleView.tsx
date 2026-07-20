import { getSegmentComparisonLabels, type SegmentRule } from '@journeylens/shared';
import { Typography } from 'antd';
import styles from './SegmentRuleView.module.css';

type SegmentRuleViewProps = { rules: SegmentRule };
type RuleNodeProps = { rule: SegmentRule; hideGroupHeading?: boolean };

function RuleNode({ rule, hideGroupHeading = false }: RuleNodeProps) {
  if (rule.kind === 'compare') {
    const { fieldLabel, operatorLabel, valueText } = getSegmentComparisonLabels(rule);
    return (
      <div className={styles.condition}>
        <Typography.Text>{fieldLabel}</Typography.Text>
        <Typography.Text type="secondary">{operatorLabel}</Typography.Text>
        <Typography.Text>{valueText}</Typography.Text>
      </div>
    );
  }

  if (rule.kind === 'not') {
    const groupLabel = rule.child.kind === 'any' ? '任一' : rule.child.kind === 'all' ? '全部' : '';
    return (
      <section className={styles.exclusion}>
        <div className={styles.exclusionHeading}>
          <Typography.Text strong className={styles.exclusionLabel ?? ''}>
            排除
          </Typography.Text>
          <Typography.Text strong>
            满足以下{groupLabel ? `${groupLabel}条件` : '条件'}的用户
          </Typography.Text>
        </div>
        <RuleNode
          rule={rule.child}
          hideGroupHeading={rule.child.kind === 'all' || rule.child.kind === 'any'}
        />
      </section>
    );
  }

  const heading = rule.kind === 'all' ? '全部满足' : '任一满足';
  return (
    <section className={styles.group}>
      {!hideGroupHeading && (
        <Typography.Text strong className={styles.groupHeading ?? ''}>
          {heading}
        </Typography.Text>
      )}
      {rule.children.length === 0 ? (
        <Typography.Text type="secondary">尚未添加条件</Typography.Text>
      ) : (
        <div className={styles.children}>
          {rule.children.map((child, index) => (
            <RuleNode key={index} rule={child} />
          ))}
        </div>
      )}
    </section>
  );
}

export function SegmentRuleView({ rules }: SegmentRuleViewProps) {
  return (
    <div className={styles.tree} role="group" aria-label="分群规则">
      <RuleNode rule={rules} />
    </div>
  );
}
