import type { CSSProperties } from 'react';
import { Flex, Input, InputNumber, Select, Typography } from 'antd';
import {
  AUDIENCE_FIELDS,
  AUDIENCE_FIELD_GROUPS,
  COMPARISON_OPERATOR_LABELS,
  audienceField,
  type AudienceField,
  type JsonScalar,
  type SegmentRuleCompare,
} from '@journeylens/shared';

type RuleCompareFieldsProps = {
  value: SegmentRuleCompare;
  /** 无障碍名称前缀，例如“条件 1”；缺省时只使用“用户属性”等通用名称。 */
  label?: string | undefined;
  disabled?: boolean | undefined;
  /** 分群规则树内单行排列；旅程设置面板较窄，使用带标签的纵向排列。 */
  layout?: 'inline' | 'stacked';
  onChange: (value: SegmentRuleCompare) => void;
};

const fieldOptions = AUDIENCE_FIELD_GROUPS.map((group) => ({
  label: group,
  options: AUDIENCE_FIELDS.filter((field) => field.group === group).map((field) => ({
    label: field.label,
    value: field.key,
  })),
}));

/**
 * 单个比较条件：用户属性、比较方式、比较值。
 * 分群规则树和旅程条件节点共用这组控件与校验；分组、增删由各自使用方负责。
 */
export function RuleCompareFields({
  value,
  label = '',
  disabled = false,
  layout = 'inline',
  onChange,
}: RuleCompareFieldsProps) {
  const stacked = layout === 'stacked';
  const field = audienceField(value.left.path)!;
  const controlStyle: CSSProperties | undefined = stacked ? { width: '100%' } : undefined;

  const updateRight = (right: JsonScalar | JsonScalar[] | undefined) => {
    const next: SegmentRuleCompare = { ...value };
    // 清空比较值时移除字段，避免留下 undefined 键影响保存校验。
    if (right === undefined) delete next.right;
    else next.right = right;
    onChange(next);
  };

  const fieldSelect = (
    <Select
      aria-label={`${label}用户属性`}
      showSearch={{ optionFilterProp: 'label' }}
      options={fieldOptions}
      disabled={disabled}
      value={value.left.path}
      style={controlStyle ?? { minWidth: 0, flex: '1 1 160px' }}
      onChange={(key: string) => {
        const nextField = audienceField(key);
        if (nextField === undefined) return;
        // 属性变化后原比较方式和比较值不再成立，需要重新选择。
        onChange({
          kind: 'compare',
          left: { source: 'user', path: nextField.key },
          operator: nextField.operators[0]!,
        });
      }}
    />
  );

  const operatorSelect = (
    <Select
      aria-label={`${label}比较方式`}
      value={value.operator}
      style={controlStyle ?? { minWidth: 0, flex: '0 0 116px' }}
      options={field.operators.map((operator) => ({
        label: COMPARISON_OPERATOR_LABELS[operator],
        value: operator,
      }))}
      disabled={disabled}
      onChange={(operator: SegmentRuleCompare['operator']) =>
        onChange({ kind: 'compare', left: value.left, operator })
      }
    />
  );

  const valueEditor = renderValueEditor(
    value,
    field,
    `${label}比较值`,
    updateRight,
    disabled,
    stacked,
  );

  if (!stacked) {
    return (
      <>
        {fieldSelect}
        {operatorSelect}
        {valueEditor}
      </>
    );
  }

  return (
    <Flex vertical gap={12}>
      <Flex vertical gap={4}>
        <Typography.Text type="secondary">用户属性</Typography.Text>
        {fieldSelect}
      </Flex>
      <Flex vertical gap={4}>
        <Typography.Text type="secondary">比较方式</Typography.Text>
        {operatorSelect}
      </Flex>
      <Flex vertical gap={4}>
        <Typography.Text type="secondary">比较值</Typography.Text>
        {valueEditor}
      </Flex>
    </Flex>
  );
}

function renderValueEditor(
  rule: SegmentRuleCompare,
  field: AudienceField,
  ariaLabel: string,
  update: (right: JsonScalar | JsonScalar[] | undefined) => void,
  disabled: boolean,
  stacked: boolean,
) {
  const style = stacked ? { width: '100%' } : { minWidth: 0, flex: '1 1 150px' };

  if (rule.operator === 'exists') {
    return (
      <Typography.Text type="secondary" style={style}>
        不需要比较值
      </Typography.Text>
    );
  }

  if (field.kind === 'number') {
    return (
      <InputNumber
        aria-label={ariaLabel}
        {...(field.minimum === undefined ? {} : { min: field.minimum })}
        {...(field.precision === undefined ? {} : { precision: field.precision })}
        disabled={disabled}
        value={typeof rule.right === 'number' ? rule.right : null}
        placeholder="请输入数字"
        style={style}
        onChange={(value) => update(value ?? undefined)}
      />
    );
  }

  if (field.kind === 'boolean') {
    return (
      <Select
        aria-label={ariaLabel}
        allowClear
        disabled={disabled}
        value={typeof rule.right === 'boolean' ? rule.right : undefined}
        placeholder="请选择"
        style={style}
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
          aria-label={ariaLabel}
          mode="multiple"
          allowClear
          disabled={disabled}
          value={selected}
          placeholder="请选择"
          style={style}
          options={field.values.map((item) => ({ label: item.label, value: item.value }))}
          onChange={(values: string[]) => update(values)}
        />
      );
    }

    return (
      <Select
        aria-label={ariaLabel}
        showSearch={{ optionFilterProp: 'label' }}
        allowClear
        disabled={disabled}
        value={typeof rule.right === 'string' ? rule.right : undefined}
        placeholder="请选择"
        style={style}
        options={field.values.map((item) => ({ label: item.label, value: item.value }))}
        onChange={(value: string | undefined) => update(value)}
      />
    );
  }

  return (
    <Input
      aria-label={ariaLabel}
      value={typeof rule.right === 'string' ? rule.right : ''}
      disabled={disabled}
      placeholder="请输入比较值"
      style={style}
      onChange={(event) => update(event.target.value || undefined)}
    />
  );
}
