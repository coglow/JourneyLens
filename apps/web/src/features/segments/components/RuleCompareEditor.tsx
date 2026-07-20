import { Button, Flex, Input, InputNumber, Select, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import {
  AUDIENCE_FIELDS,
  AUDIENCE_FIELD_GROUPS,
  COMPARISON_OPERATOR_LABELS,
  audienceField,
  type JsonScalar,
  type SegmentRule,
  type SegmentRulePath,
} from '@journeylens/shared';
import { removeAtPath, rulePathId, updateAtPath } from '@/features/segments/segment-rule-tree';
import styles from './RuleTreeEditor.module.css';

type SegmentCompareRule = Extract<SegmentRule, { kind: 'compare' }>;

type RuleCompareEditorProps = {
  value: SegmentCompareRule;
  treeRoot: SegmentRule;
  path: SegmentRulePath;
  label: string;
  conflicted: boolean;
  canRemove: boolean;
  onChange: (value: SegmentRule) => void;
};

const segmentFieldOptions = AUDIENCE_FIELD_GROUPS.map((group) => ({
  label: group,
  options: AUDIENCE_FIELDS.filter((field) => field.group === group).map((field) => ({
    label: field.label,
    value: field.key,
  })),
}));

/** 单个比较条件：用户属性、比较方式、比较值和删除入口。 */
export function RuleCompareEditor({
  value,
  treeRoot,
  path,
  label,
  conflicted,
  canRemove,
  onChange,
}: RuleCompareEditorProps) {
  const field = audienceField(value.left.path)!;
  const updateRight = (right: JsonScalar | JsonScalar[] | undefined) =>
    onChange(
      updateAtPath(treeRoot, path, (node) => {
        if (node.kind === 'compare') {
          if (right === undefined) delete node.right;
          else node.right = right;
        }
      }),
    );

  return (
    <div
      id={rulePathId(path)}
      tabIndex={-1}
      className={`${styles.condition} ${conflicted ? styles.conflicted : ''}`}
    >
      <Flex align="center" gap={8}>
        <Select
          aria-label={`${label}用户属性`}
          showSearch={{ optionFilterProp: 'label' }}
          options={segmentFieldOptions}
          value={value.left.path}
          style={{ minWidth: 0, flex: '1 1 160px' }}
          onChange={(key: string) => {
            const nextField = audienceField(key);
            if (nextField === undefined) return;
            onChange(
              updateAtPath(treeRoot, path, (node) => {
                if (node.kind === 'compare') {
                  node.left.path = nextField.key;
                  node.operator = nextField.operators[0]!;
                  delete node.right;
                }
              }),
            );
          }}
        />
        <Select
          aria-label={`${label}比较方式`}
          value={value.operator}
          style={{ minWidth: 0, flex: '0 0 116px' }}
          options={field.operators.map((operator) => ({
            label: COMPARISON_OPERATOR_LABELS[operator],
            value: operator,
          }))}
          onChange={(operator: typeof value.operator) =>
            onChange(
              updateAtPath(treeRoot, path, (node) => {
                if (node.kind === 'compare') {
                  node.operator = operator;
                  delete node.right;
                }
              }),
            )
          }
        />
        {renderRightEditor(value, field, label, updateRight)}
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

function renderRightEditor(
  rule: SegmentCompareRule,
  field: NonNullable<ReturnType<typeof audienceField>>,
  label: string,
  update: (right: JsonScalar | JsonScalar[] | undefined) => void,
) {
  if (rule.operator === 'exists') {
    return (
      <Typography.Text type="secondary" style={{ flex: '1 1 auto' }}>
        不需要比较值
      </Typography.Text>
    );
  }

  if (field.kind === 'number') {
    return (
      <InputNumber
        aria-label={`${label}比较值`}
        {...(field.minimum === undefined ? {} : { min: field.minimum })}
        {...(field.precision === undefined ? {} : { precision: field.precision })}
        value={typeof rule.right === 'number' ? rule.right : null}
        placeholder="请输入数字"
        style={{ minWidth: 0, flex: '1 1 150px' }}
        onChange={(value) => update(value ?? undefined)}
      />
    );
  }

  if (field.kind === 'boolean') {
    return (
      <Select
        aria-label={`${label}比较值`}
        allowClear
        value={typeof rule.right === 'boolean' ? rule.right : undefined}
        placeholder="请选择"
        style={{ minWidth: 0, flex: '1 1 150px' }}
        options={[
          { label: '是', value: true },
          { label: '否', value: false },
        ]}
        onChange={(value: boolean | undefined) => update(value)}
      />
    );
  }

  if (field.values !== undefined) {
    if (rule.operator === 'in' || rule.operator === 'not_in') {
      const selected = Array.isArray(rule.right)
        ? rule.right.filter((item): item is string => typeof item === 'string')
        : [];
      return (
        <Select
          aria-label={`${label}比较值`}
          mode="multiple"
          allowClear
          value={selected}
          placeholder="请选择"
          style={{ minWidth: 0, flex: '1 1 150px' }}
          options={field.values.map((item) => ({ label: item.label, value: item.value }))}
          onChange={(values: string[]) => update(values)}
        />
      );
    }

    return (
      <Select
        aria-label={`${label}比较值`}
        showSearch={{ optionFilterProp: 'label' }}
        allowClear
        value={typeof rule.right === 'string' ? rule.right : undefined}
        placeholder="请选择"
        style={{ minWidth: 0, flex: '1 1 150px' }}
        options={field.values.map((item) => ({ label: item.label, value: item.value }))}
        onChange={(value: string | undefined) => update(value)}
      />
    );
  }

  return (
    <Input
      aria-label={`${label}比较值`}
      value={typeof rule.right === 'string' ? rule.right : ''}
      placeholder="请输入比较值"
      style={{ minWidth: 0, flex: '1 1 150px' }}
      onChange={(event) => update(event.target.value || undefined)}
    />
  );
}
