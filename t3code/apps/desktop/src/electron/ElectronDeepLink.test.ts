import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDeepLinkUrl, handleDeepLink, initDeepLink, registerDeepLinkProtocol } from './ElectronDeepLink';
import { app, BrowserWindow } from 'electron';

// Mock Electron modules
vi.mock('electron', () => ({
  app: {
    isDefaultProtocolClient: vi.fn().mockReturnValue(false),
    setAsDefaultProtocolClient: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
    getFocusedWindow: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('path', () => ({
  default: {
    normalize: vi.fn((p: string) => p),
    join: vi.fn((...args: string[]) => args.join('/')),
  },
}));

vi.mock('url', () => ({
  URL: class {
    protocol: string;
    hostname: string;
    search: string;
    constructor(url: string) {
      const parsed = new URL(url);
      this.protocol = parsed.protocol;
      this.hostname = parsed.hostname;
      this.search = parsed.search;
    }
  },
}));

describe('ElectronDeepLink', () => {
  describe('parseDeepLinkUrl', () => {
    it('should parse valid t3code://open URL with path', () => {
      const result = parseDeepLinkUrl('t3code://open?path=my-project');
      expect(result).toEqual({ type: 'open', path: 'my-project' });
    });

    it('should parse valid t3code://chat URL with id', () => {
      const result = parseDeepLinkUrl('t3code://chat?id=abc123');
      expect(result).toEqual({ type: 'chat', id: 'abc123' });
    });

    it('should parse valid t3code://settings URL', () => {
      const result = parseDeepLinkUrl('t3code://settings');
      expect(result).toEqual({ type: 'settings' });
    });

    it('should reject invalid protocol', () => {
      const result = parseDeepLinkUrl('http://open?path=test');
      expect(result).toBeNull();
    });

    it('should reject path traversal attempts with ..', () => {
      const result = parseDeepLinkUrl('t3code://open?path=../etc/passwd');
      expect(result).toBeNull();
    });

    it('should reject path traversal attempts with /', () => {
      const result = parseDeepLinkUrl('t3code://open?path=/etc/passwd');
      expect(result).toBeNull();
    });

    it('should reject invalid thread ID with special characters', () => {
      const result = parseDeepLinkUrl('t3code://chat?id=<script>');
      expect(result).toBeNull();
    });

    it('should accept valid thread ID with alphanumeric and hyphens', () => {
      const result = parseDeepLinkUrl('t3code://chat?id=thread-123');
      expect(result).toEqual({ type: 'chat', id: 'thread-123' });
    });

    it('should reject malformed URLs', () => {
      const result = parseDeepLinkUrl('not-a-url');
      expect(result).toBeNull();
    });

    it('should handle URL with multiple query parameters', () => {
      const result = parseDeepLinkUrl('t3code://open?path=my-project&other=value');
      expect(result).toEqual({ type: 'open', path: 'my-project' });
    });
  });

  describe('registerDeepLinkProtocol', () => {
    it('should register protocol handler on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      registerDeepLinkProtocol();
      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('t3code');
    });

    it('should not re-register if already default handler', () => {
      vi.mocked(app.isDefaultProtocolClient).mockReturnValue(true);
      registerDeepLinkProtocol();
      expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    });
  });

  describe('handleDeepLink', () => {
    it('should return false for invalid URL', () => {
      const result = handleDeepLink('invalid-url');
      expect(result).toBe(false);
    });

    it('should return true for valid open project URL', () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { isFocused: vi.fn().mockReturnValue(true), focus: vi.fn(), webContents: { send: vi.fn() } } as any
      ]);
      const result = handleDeepLink('t3code://open?path=my-project');
      expect(result).toBe(true);
    });

    it('should return true for valid chat URL', () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { isFocused: vi.fn().mockReturnValue(true), focus: vi.fn(), webContents: { send: vi.fn() } } as any
      ]);
      const result = handleDeepLink('t3code://chat?id=abc123');
      expect(result).toBe(true);
    });

    it('should return true for valid settings URL', () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { isFocused: vi.fn().mockReturnValue(true), focus: vi.fn(), webContents: { send: vi.fn() } } as any
      ]);
      const result = handleDeepLink('t3code://settings');
      expect(result).toBe(true);
    });
  });

  describe('initDeepLink', () => {
    it('should call registerDeepLinkProtocol', () => {
      const mockRegister = vi.fn();
      vi.mocked(registerDeepLinkProtocol).mockImplementation(mockRegister);
      initDeepLink();
      expect(mockRegister).toHaveBeenCalled();
    });

    it('should handle deep link from command line args', () => {
      const originalArgv = process.argv;
      process.argv = ['node', 'script.js', 't3code://open?path=test'];
      
      const mockHandle = vi.fn();
      vi.mocked(handleDeepLink).mockImplementation(mockHandle);
      
      initDeepLink();
      
      // Trigger ready event
      const readyCallback = vi.mocked(app.once).mock.calls[0][1];
      readyCallback();
      
      expect(mockHandle).toHaveBeenCalledWith('t3code://open?path=test');
      
      process.argv = originalArgv;
    });
  });
});
