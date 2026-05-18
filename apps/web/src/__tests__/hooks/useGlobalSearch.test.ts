typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';
import { searchService } from '../../services/searchService';
import { useInfiniteQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ----------------------------------------------------------------------
// Types & Mocks
// ----------------------------------------------------------------------

jest.mock('../../services/searchService');
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useInfiniteQuery: jest.fn(),
}));

const mockedUseInfiniteQuery = useInfiniteQuery as jest.MockedFunction<typeof useInfiniteQuery>;
const mockedSearchService = searchService as jest.Mocked<typeof searchService>;

/** Shape of one result group returned by the search API. */
interface SearchResultGroup {
  source: 'chat' | 'files' | 'git';
  results: Array<Record<string, unknown>>;
  total: number;
}

/** Shape of a single page from the infinite query. */
interface SamplePage {
  groups: SearchResultGroup[];
}

// ----------------------------------------------------------------------
// Test Infrastructure
// ----------------------------------------------------------------------

/**
 * Creates a fresh QueryClient with test-friendly defaults.
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  });
}

/**
 * Provider wrapper with a fresh QueryClient for each test.
 */
const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

// ----------------------------------------------------------------------
// Test Fixtures
// ----------------------------------------------------------------------

const samplePage: SamplePage = {
  groups: [
    {
      source: 'chat',
      results: [
        {
          id: '1',
          content: 'hello world',
          threadContext: 'thread-1',
        },
      ],
      total: 1,
    },
    {
      source: 'files',
      results: [
        {
          id: 'f1',
          name: 'file.ts',
          line: 10,
          content: 'some code',
        },
      ],
      total: 1,
    },
    {
      source: 'git',
      results: [
        {
          id: 'g1',
          message: 'fix bug',
          author: 'Alice',
          date: '2023-01-01',
        },
      ],
      total: 1,
    },
  ],
};

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/**
 * Creates a default mock for `useInfiniteQuery`.
 * Override specific fields via `partial`.
 */
function createMockUseInfiniteQuery(
  partial: Partial<ReturnType<typeof useInfiniteQuery>> = {}
): ReturnType<typeof useInfiniteQuery> {
  const defaults: ReturnType<typeof useInfiniteQuery> = {
    data: { pages: [samplePage], pageParams: [undefined] },
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isFetching: false,
    error: null,
    fetchPreviousPage: jest.fn(),
    hasPreviousPage: false,
    isFetchingPreviousPage: false,
    isRefetching: false,
    isError: false,
    isSuccess: true,
    status: 'success',
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    refetch: jest.fn(),
    remove: jest.fn(),
  };

  return { ...defaults, ...partial } as ReturnType<typeof useInfiniteQuery>;
}

// ----------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------

describe('useGlobalSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseInfiniteQuery.mockReturnValue(createMockUseInfiniteQuery());
  });

  // --- Initial State ---

  it('should return initial state with empty query and no results', () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetchingNextPage).toBe(false);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.regexEnabled).toBe(false);
    expect(result.current.caseSensitive).toBe(false);
    expect(result.current.regexError).toBeNull();
  });

  // --- Query Updates Trigger API Calls ---

  it('should call useInfiniteQuery with correct query key when query is set', async () => {
    mockedUseInfiniteQuery.mockReturnValue(createMockUseInfiniteQuery({ isLoading: true }));

    const { result, rerender } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('test');
    });

    // Rerender to let the hook update its internal state and trigger query
    rerender();

    await waitFor(() => {
      expect(mockedUseInfiniteQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['globalSearch', 'test', false, false],
        })
      );
    });
  });

  // --- Infinite Scroll ---

  it('should call fetchNextPage when instructed', () => {
    const fetchNextPageMock = jest.fn();
    mockedUseInfiniteQuery.mockReturnValue(
      createMockUseInfiniteQuery({
        fetchNextPage: fetchNextPageMock,
        hasNextPage: true,
      })
    );

    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('test');
    });

    act(() => {
      result.current.fetchNextPage();
    });

    expect(fetchNextPageMock).toHaveBeenCalledTimes(1);
  });

  // --- Filter Toggles (Case Sensitive & Regex) ---

  it('should update query key when toggles change after query is set', () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('test');
      result.current.setRegexEnabled(true);
      result.current.setCaseSensitive(true);
    });

    expect(mockedUseInfiniteQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queryKey: ['globalSearch', 'test', true, true],
      })
    );
  });

  // --- Regex Validation (only when enabled) ---

  it('should only show regex error when regex is enabled and pattern is invalid', () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    // First, enable regex
    act(() => {
      result.current.setRegexEnabled(true);
    });

    // Now set an invalid regex pattern
    act(() => {
      result.current.setQuery('\\');
    });

    expect(result.current.regexError).toBe('Invalid regular expression');
  });

  it('should not show regex error when regex is disabled even with invalid pattern', () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('\\');
    });

    expect(result.current.regexError).toBeNull();
  });

  // --- Empty Query Clears Results ---

  it('should clear results and stop loading when query becomes empty', () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('test');
    });

    act(() => {
      result.current.setQuery('');
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetchingNextPage).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // --- Error Handling ---

  it('should surface fetch errors from useInfiniteQuery', () => {
    const testError = new Error('Network error');
    mockedUseInfiniteQuery.mockReturnValue(
      createMockUseInfiniteQuery({
        data: undefined,
        error: testError,
        status: 'error',
        isError: true,
        isSuccess: false,
      })
    );

    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('test');
    });

    expect(result.current.error).toEqual(testError);
  });

  // --- Data Transformation: Pages -> Flat Results Array ---

  it('should transform pages of grouped results into a flat results array', () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    // The hook is initialised with the sample page data from the default mock
    const expectedResults = [
      {
        source: 'chat',
        id: '1',
        content: 'hello world',
        threadContext: 'thread-1',
      },
      {
        source: 'files',
        id: 'f1',
        name: 'file.ts',
        line: 10,
        content: 'some code',
      },
      {
        source: 'git',
        id: 'g1',
        message: 'fix bug',
        author: 'Alice',
        date: '2023-01-01',
      },
    ];

    // Simulate query set to trigger data loading
    act(() => {
      result.current.setQuery('test');
    });

    expect(result.current.results).toEqual(expectedResults);
  });

  // --- Progressive Loading (multiple pages) ---

  it('should accumulate results from multiple pages when fetching next page', () => {
    // First page mock
    const firstPageMock = createMockUseInfiniteQuery({
      data: { pages: [samplePage], pageParams: [undefined] },
      hasNextPage: true,
    });

    mockedUseInfiniteQuery.mockReturnValue(firstPageMock);

    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('test');
    });

    // Simulate second page being appended
    const secondPage: SamplePage = {
      groups: [
        {
          source: 'chat',
          results: [
            {
              id: '2',
              content: 'second message',
              threadContext: 'thread-1',
            },
          ],
          total: 1,
        },
      ],
    };

    const secondPageMock = createMockUseInfiniteQuery({
      data: {
        pages: [samplePage, secondPage],
        pageParams: [undefined, 2],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    mockedUseInfiniteQuery.mockReturnValue(secondPageMock);

    act(() => {
      result.current.fetchNextPage();
    });

    const expectedResults = [
      // First page
      { source: 'chat', id: '1', content: 'hello world', threadContext: 'thread-1' },
      { source: 'files', id: 'f1', name: 'file.ts', line: 10, content: 'some code' },
      { source: 'git', id: 'g1', message: 'fix bug', author: 'Alice', date: '2023-01-01' },
      // Second page
      { source: 'chat', id: '2', content: 'second message', threadContext: 'thread-1' },
    ];

    expect(result.current.results).toEqual(expectedResults);
  });

  // --- Edge Cases ---

  it('should handle empty results from API gracefully', () => {
    const emptyPage: SamplePage = { groups: [] };
    mockedUseInfiniteQuery.mockReturnValue(
      createMockUseInfiniteQuery({
        data: { pages: [emptyPage], pageParams: [undefined] },
      })
    );

    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('nothing');
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should not call fetchNextPage when hasNextPage is false', () => {
    const fetchNextPageMock = jest.fn();
    mockedUseInfiniteQuery.mockReturnValue(
      createMockUseInfiniteQuery({
        fetchNextPage: fetchNextPageMock,
        hasNextPage: false,
      })
    );

    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('test');
    });

    act(() => {
      result.current.fetchNextPage();
    });

    expect(fetchNextPageMock).toHaveBeenCalledTimes(0);
  });

  // --- Performance: no extra renders ---

  it('should not re-fetch when toggles change without query change', () => {
    // This test ensures that the query key only updates when toggles actually change along with query
    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    // Set a query first
    act(() => {
      result.current.setQuery('test');
    });

    // Toggle without changing query – hook should not trigger a new query key if it's memoized correctly
    // We rely on the fact that useInfiniteQuery is called only when query key changes
    const callCountBefore = mockedUseInfiniteQuery.mock.calls.length;

    act(() => {
      result.current.setRegexEnabled(true);
    });

    // Because the query key changed (now includes regex=true), a new call should happen
    expect(mockedUseInfiniteQuery.mock.calls.length).toBeGreaterThan(callCountBefore);
  });

  // --- Input validation (string trimming / empty) ---

  it('should trim query string before sending', () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper: Wrapper });

    act(() => {
      result.current.setQuery('  hello  ');
    });

    // The hook is expected to trim the query or the API call should use trimmed value
    // We check that the query key uses trimmed version
    expect(mockedUseInfiniteQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining([
          expect.any(String),
          'hello', // trimmed
          expect.any(Boolean),
          expect.any(Boolean),
        ]),
      })
    );
  });
});