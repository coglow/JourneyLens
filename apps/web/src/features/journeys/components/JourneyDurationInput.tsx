import { useState } from 'react';
import { Flex, InputNumber, Select } from 'antd';
import { WAIT_UNITS, waitUnitFor, type WaitUnit } from '@/features/journeys/journey-wait';

type Props = {
  label: string;
  seconds: number;
  min: number;
  disabled?: boolean;
  hasError?: boolean;
  onChange: (seconds: number | null) => void;
};

/** 等待时长和模拟行为时间都按秒保存，输入单位只影响界面显示。 */
export function JourneyDurationInput({
  label,
  seconds,
  min,
  disabled = false,
  hasError = false,
  onChange,
}: Props) {
  const [preferredUnit, setPreferredUnit] = useState<WaitUnit>(() => waitUnitFor(seconds).value);
  const currentUnit =
    WAIT_UNITS.find((item) => item.value === preferredUnit && seconds % item.seconds === 0) ??
    waitUnitFor(seconds);

  return (
    <Flex gap={8}>
      <InputNumber
        aria-label={`${label}数值`}
        min={min}
        precision={0}
        status={hasError ? 'error' : ''}
        value={seconds / currentUnit.seconds}
        disabled={disabled}
        style={{ flex: 1 }}
        onChange={(value) => onChange(value === null ? null : value * currentUnit.seconds)}
      />
      <Select
        aria-label={`${label}单位`}
        style={{ width: 80 }}
        value={currentUnit.value}
        disabled={disabled}
        options={WAIT_UNITS.map(({ label: unitLabel, value }) => ({
          label: unitLabel,
          value,
        }))}
        onChange={(nextUnit: WaitUnit) => {
          const next = WAIT_UNITS.find((item) => item.value === nextUnit)!;
          setPreferredUnit(nextUnit);
          // 单位切换保留当前数值，再换算成秒交给调用方。
          onChange((seconds / currentUnit.seconds) * next.seconds);
        }}
      />
    </Flex>
  );
}
