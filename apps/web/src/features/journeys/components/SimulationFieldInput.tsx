import { useState } from 'react';
import { EllipsisOutlined } from '@ant-design/icons';
import { Button, Checkbox, Dropdown, Input, InputNumber, Select, Typography } from 'antd';
import styles from './SimulationScenarioEditor.module.css';
import type { SimulationField } from '@journeylens/shared';

type Props = {
  field: SimulationField;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
};

/** 按静态字段目录选控件；空值与未提供分别保留，证据可以看出两种情况。 */
export function SimulationFieldInput({ field, value, disabled = false, onChange }: Props) {
  const [editingNull, setEditingNull] = useState(false);
  const isNull = value === null;
  const nullChecked = isNull && !editingNull;

  // 空值仍为 null 时，输入模式可保持输入框可编辑；复选框只表示锁定空值。
  const isEmptyList = field.kind === 'string[]' && Array.isArray(value) && value.length === 0;
  const values = field.values;
  const maxLength = 'maxLength' in field ? field.maxLength : undefined;

  let control;
  if (field.kind === 'number') {
    control = (
      <InputNumber
        aria-label={field.label}
        size="large"
        autoFocus={editingNull}
        value={typeof value === 'number' ? value : null}
        {...(field.minimum === undefined ? {} : { min: field.minimum })}
        {...(field.precision === undefined ? {} : { precision: field.precision })}
        disabled={disabled || nullChecked}
        style={{ width: '100%' }}
        onChange={(next) => onChange(next ?? undefined)}
      />
    );
  } else if (field.kind === 'boolean') {
    control = (
      <Select
        aria-label={field.label}
        size="large"
        autoFocus={editingNull}
        value={typeof value === 'boolean' ? value : undefined}
        placeholder={nullChecked ? '已设为空值' : '未提供'}
        allowClear
        disabled={disabled || nullChecked}
        options={[
          { label: '是', value: true },
          { label: '否', value: false },
        ]}
        onChange={(next: boolean | undefined) => onChange(next)}
      />
    );
  } else if (field.kind === 'string[]') {
    control = (
      <Select
        aria-label={field.label}
        size="large"
        autoFocus={editingNull}
        mode="multiple"
        value={
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string')
            : []
        }
        placeholder={nullChecked ? '已设为空值' : isEmptyList ? '空列表' : '未提供'}
        allowClear
        disabled={disabled || nullChecked}
        options={(field.values ?? []).map((item) => ({ label: item.label, value: item.value }))}
        onChange={(next: string[]) => onChange(next.length === 0 ? undefined : next)}
      />
    );
  } else if (values !== undefined) {
    control = (
      <Select
        aria-label={field.label}
        size="large"
        autoFocus={editingNull}
        value={typeof value === 'string' ? value : undefined}
        placeholder={nullChecked ? '已设为空值' : '未提供'}
        allowClear
        disabled={disabled || nullChecked}
        options={values.map((item) => ({ label: item.label, value: item.value }))}
        onChange={(next: string | undefined) => onChange(next)}
      />
    );
  } else {
    control = (
      <Input
        aria-label={field.label}
        size="large"
        autoFocus={editingNull}
        allowClear
        value={typeof value === 'string' ? value : ''}
        maxLength={maxLength}
        disabled={disabled || nullChecked}
        placeholder={nullChecked ? '已设为空值' : '未提供'}
        onChange={(event) => {
          const next = event.target.value || undefined;
          setEditingNull(true);
          onChange(next);
        }}
      />
    );
  }

  return (
    <div className={styles.field} role="group" aria-label={field.label}>
      <Typography.Text className={styles.fieldLabel ?? ''}>{field.label}</Typography.Text>
      <div className={styles.controlRow}>
        <div className={styles.control}>{control}</div>
        <Checkbox
          aria-label={`${field.label}设为空值`}
          checked={nullChecked}
          disabled={disabled}
          onChange={(event) => {
            const nextChecked = event.target.checked;
            setEditingNull(!nextChecked);
            onChange(nextChecked ? null : undefined);
          }}
        >
          设为空值
        </Checkbox>
        {field.kind === 'string[]' && (
          <Dropdown
            trigger={['click']}
            disabled={disabled}
            autoFocus
            menu={{
              items: [{ key: 'empty-list', label: '设为空列表', disabled: isEmptyList }],
              onClick: () => onChange([]),
            }}
          >
            <Button
              size="large"
              icon={<EllipsisOutlined aria-hidden />}
              aria-label={`${field.label}的更多操作`}
              disabled={disabled}
            />
          </Dropdown>
        )}
      </div>
    </div>
  );
}
