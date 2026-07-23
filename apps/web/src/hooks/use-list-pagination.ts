import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';

type PageParams = {
  page: number;
  pageSize: number;
  pageParam: string | undefined;
  pageSizeParam: string | undefined;
};

/** 网址里的原始分页参数交给各模块 service 校验，非法值要明确报错，不在这里静默改成默认值。 */
function readPageParams(searchParams: URLSearchParams): PageParams {
  const pageParam = searchParams.get('page') ?? undefined;
  const pageSizeParam = searchParams.get('pageSize') ?? undefined;
  return {
    page: pageParam === undefined ? 1 : Number(pageParam),
    pageSize: pageSizeParam === '20' ? 20 : pageSizeParam === '50' ? 50 : 10,
    pageParam,
    pageSizeParam,
  };
}

/** 列表分页只住在网址：读取当前页，写回用户操作，并保留来源页写入的状态。 */
export function useListPagination() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { page, pageSize, pageParam, pageSizeParam } = readPageParams(searchParams);

  function setPagination(nextPage: number, nextPageSize: number): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        const pageSizeChanged = nextPageSize !== pageSize;
        if (nextPageSize === 10) next.delete('pageSize');
        else next.set('pageSize', String(nextPageSize));
        if (pageSizeChanged || nextPage === 1) next.delete('page');
        else next.set('page', String(nextPage));
        return next;
      },
      { state: location.state },
    );
  }

  return { page, pageSize, pageParam, pageSizeParam, setPagination };
}

type PageQuery = {
  data: { page: { page: number } } | undefined;
  isFetching: boolean;
  isRefetchError: boolean;
  isFetchedAfterMount: boolean;
};

/** 删除末端记录后服务端会返回有效页码，等本次读取完成再修正网址，避免依据旧缓存跳页。 */
export function useSyncListPage(query: PageQuery): void {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { page } = readPageParams(searchParams);
  const serverPage = query.data?.page.page;

  useEffect(() => {
    if (serverPage === undefined || query.isFetching || query.isRefetchError) return;
    if (!query.isFetchedAfterMount || serverPage === page) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (serverPage === 1) next.delete('page');
        else next.set('page', String(serverPage));
        return next;
      },
      { replace: true, state: location.state },
    );
  }, [
    location.state,
    page,
    query.isFetchedAfterMount,
    query.isFetching,
    query.isRefetchError,
    serverPage,
    setSearchParams,
  ]);
}
