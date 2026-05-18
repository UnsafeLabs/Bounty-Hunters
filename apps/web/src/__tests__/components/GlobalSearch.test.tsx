import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GlobalSearch from '@/components/GlobalSearch';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import type { UseGlobalSearchReturn } from '@/hooks/useGlobalSearch';

jest.mock('@/hooks/useGlobalSearch');

const mockUseGlobalSearch = useGlobalSearch as jest.MockedFunction<
  typeof useGlobalSearch
>;

const defaultMock: UseGlobalSearchReturn = {
  query: '',
  setQuery: jest.fn(),
  isOpen: false,
  openSearch: jest.fn(),
  closeSearch: jest.fn(),
  regexEnabled: false,
  toggleRegex: jest.fn(),
  caseSensitive: false,
  toggleCaseSensitive: jest.fn(),
  isLoading: false,
  results: null,
  error: null,
  fetchNextPage: jest.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseGlobalSearch.mockReturnValue({ ...defaultMock });
});

/**
 * Test suite for GlobalSearch component.
 *
 * Verifies opening via Ctrl+Shift+F, closing via Escape,
 * input binding, filter toggles, and rendering of result groups.
 */
describe('GlobalSearch', () => {
  it('opens the search overlay when Ctrl+Shift+F is pressed', () => {
    const openSearch = jest.fn();
    mockUseGlobalSearch.mockReturnValue({
      ...defaultMock,
      isOpen: true,
      openSearch,
    });
    render(<GlobalSearch />);
    // Simulate global keyboard shortcut
    fireEvent.keyDown(window, {
      key: 'F',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(openSearch).toHaveBeenCalledTimes(1);
  });

  it('closes the search overlay when Escape is pressed', () => {
    const closeSearch = jest.fn();
    mockUseGlobalSearch.mockReturnValue({
      ...defaultMock,
      isOpen: true,
      closeSearch,
    });
    render(<GlobalSearch />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeSearch).toHaveBeenCalledTimes(1);
  });

  it('updates query input when user types', async () => {
    const setQuery = jest.fn();
    mockUseGlobalSearch.mockReturnValue({
      ...defaultMock,
      isOpen: true,
      setQuery,
    });
    render(<GlobalSearch />);
    const input = screen.getByRole('textbox', { name: /search/i });
    await userEvent.type(input, 'hello world');
    // setQuery is called for each character
    expect(setQuery).toHaveBeenCalledWith('hello world');
  });

  it('toggles regex filter on click', async () => {
    const toggleRegex = jest.fn();
    mockUseGlobalSearch.mockReturnValue({
      ...defaultMock,
      isOpen: true,
      regexEnabled: false,
      toggleRegex,
    });
    render(<GlobalSearch />);
    const regexButton = screen.getByRole('switch', { name: /regex/i });
    await userEvent.click(regexButton);
    expect(toggleRegex).toHaveBeenCalledTimes(1);
  });

  it('toggles case sensitivity filter on click', async () => {
    const toggleCaseSensitive = jest.fn();
    mockUseGlobalSearch.mockReturnValue({
      ...defaultMock,
      isOpen: true,
      caseSensitive: false,
      toggleCaseSensitive,
    });
    render(<GlobalSearch />);
    const caseButton = screen.getByRole('switch', { name: /case/i });
    await userEvent.click(caseButton);
    expect(toggleCaseSensitive).toHaveBeenCalledTimes(1);
  });

  it('renders result groups for chat, files, and git', () => {
    const results = {
      groups: [
        {
          source: 'chat' as const,
          label: 'Chat Messages',
          count: 2,
          icon: 'MessageSquare',
          results: [
            { id: '1', threadTitle: 'Thread A', snippet: 'hello world', matchText: 'world' },
            { id: '2', threadTitle: 'Thread B', snippet: 'test data', matchText: 'data' },
          ],
        },
        {
          source: 'files' as const,
          label: 'Files',
          count: 1,
          icon: 'File',
          results: [
            { id: 'f1', fileName: 'index.ts', lineNumber: 5, snippet: 'const x = 1;', matchText: 'x' },
          ],
        },
        {
          source: 'git' as const,
          label: 'Git Commits',
          count: 1,
          icon: 'GitCommit',
          results: [
            { id: 'g1', commitMessage: 'fix bug', author: 'Alice', date: '2024-01-01', snippet: 'fix bug', matchText: 'bug' },
          ],
        },
      ],
    };
    mockUseGlobalSearch.mockReturnValue({
      ...defaultMock,
      isOpen: true,
      query: 'test',
      results,
    });
    render(<GlobalSearch />);
    expect(screen.getByText('Chat Messages')).toBeInTheDocument();
    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByText('Git Commits')).toBeInTheDocument();
    // Check individual items
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
    expect(screen.getByText(/index.ts:5/)).toBeInTheDocument();
    expect(screen.getByText(/fix bug/)).toBeInTheDocument();
  });

  it('shows group counts next to labels', () => {
    const results = {
      groups: [
        {
          source: 'chat' as const,
          label: 'Chat Messages',
          count: 3,
          icon: 'MessageSquare',
          results: [],
        },
      ],
    };
    mockUseGlobalSearch.mockReturnValue({
      ...defaultMock,
      isOpen: true,
      query: 'test',
      results,
    });
    render(<GlobalSearch />);
    expect(screen.getByText(/\(3\)/)).toBeInTheDocument();
  });
});