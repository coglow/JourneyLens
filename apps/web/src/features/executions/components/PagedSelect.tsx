import { useDeferredValue, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Select, Spin } from 'antd';

export type PagedSelectOption = { id: string; name: string };

type PagedSelectProps = {
  id?: string;
  resourceKey: string;
  value?: string | undefined;
  onChange?: (value: string | undefined) => void;
  placeholder: string;
  disabled?: boolean;
  selectedOption?: PagedSelectOption | undefined;
  loadPage: (input: { q?: string; page: number; pageSize: 10 | 20 | 50 }) => Promise<{
    data: PagedSelectOption[];
    page: { page: number; pageSize: number; total: number };
  }>;
};

const OPTION_PAGE_SIZE = 20 as const;

export function PagedSelect({
  id,
  resourceKey,
  value,
  onChange,
  placeholder,
  disabled = false,
  selectedOption,
  loadPage,
}: PagedSelectProps) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const query = useInfiniteQuery({
    queryKey: ['execution-filter-options', resourceKey, deferredSearch],
    queryFn: ({ pageParam }) =>
      loadPage({
        ...(deferredSearch ? { q: deferredSearch } : {}),
        page: pageParam,
        pageSize: OPTION_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const lastPage = Math.max(1, Math.ceil(last.page.total / last.page.pageSize));
      return last.page.page < lastPage ? last.page.page + 1 : undefined;
    },
    enabled: !disabled,
  });

  const loaded = query.data?.pages.flatMap((page) => page.data) ?? [];
  const options = [...loaded];
  if (selectedOption !== undefined && !options.some((option) => option.id === selectedOption.id)) {
    options.unshift(selectedOption);
  }

  return (
    <Select
      {...(id === undefined ? {} : { id })}
      showSearch={{
        filterOption: false,
        onSearch: (next) => setSearch(next),
      }}
      allowClear
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      options={options.map((option) => ({ value: option.id, label: option.name }))}
      onChange={(next: string | undefined) => onChange?.(next || undefined)}
      onClear={() => setSearch('')}
      loading={query.isFetching}
      notFoundContent={
        query.isFetching ? <Spin size="small" aria-label="正在读取选项" /> : '没有匹配项'
      }
      onPopupScroll={(event) => {
        const target = event.currentTarget;
        const reachedBottom = target.scrollTop + target.offsetHeight >= target.scrollHeight - 4;
        if (reachedBottom && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      }}
      style={{ width: '100%' }}
    />
  );
}
