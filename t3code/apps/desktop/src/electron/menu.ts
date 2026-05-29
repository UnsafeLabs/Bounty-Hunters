import { Menu, MenuItemConstructorOptions } from 'electron';
import { mainIpc, IpcValidatedRequest } from '@stackkit-mvp/electron-trpc';

export const createMenu = (): Electron.Menu => {
  const isMac = process.platform === 'darwin';

  const menuTemplate: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    
    {
      label: 'Developer',
      submenu: [
        {
          label: 'Toggle Terminal',
          click: () => {
            mainIpc.client.workspace.toggleTerminal.mutate({} as IpcValidatedRequest);
          },
          accelerator: 'CmdOrCtrl+Shift+T'
        },
        {
          label: 'Clear Terminal',
          click: () => {
            mainIpc.client.terminal.clear.mutate({} as IpcValidatedRequest);
          },
          accelerator: 'CmdOrCtrl+K'
        },
        {
          label: 'Restart Backend',
          click: () => {
            mainIpc.client.dev.restartBackend.mutate({} as IpcValidatedRequest);
          },
          // No default accelerator - this is a manual operation
        },
        {
          label: 'Open DevTools',
          click: () => {
            // Would need to implement the actual DevTools opening logic here
          },
          accelerator: isMac ? 'Option+Cmd+I' : 'Ctrl+Shift+I'
        }
      ]
    },
    {
      label: 'Git',
      submenu: [
        {
          label: 'Stage All Changes',
          click: () => {
            mainI1pc.client.git.stageAll.mutate({} as IpcValidatedRequest);
          },
          accelerator: 'CmdOrCtrl+Shift+A'
        },
        {
          label: 'Commit',
          click: () => {
            mainIpc.client.git.commit.mutate({} as IpcValidatedRequest);
          },
          accelerator: 'CmdOrCtrl+Enter',
        },
        {
          label: 'Push',
          click: () => {
            mainIpc.client.git.push.mutate({} as IpcValidatedRequest);
          },
          accelerator: 'CmdOrCtrl+Shift+P'
        },
        {
          label: 'Pull',
          click: () => {
            mainIpc.client.git.pull.mutate({} as IpcValidatedRequest);
          }
        },
        {
          label: 'Create Branch',
          click: () => {
            mainIpc.client.git.createBranch.mutate({} as IpcValidatedRequest);
          },
          accelerator: 'CmdOrCtrl+Shift+B'
        }
      ]
    }
  ];

  return Menu.buildApplicationMenu(menuTemplate);
};

// Note: This is a simplified implementation. In a real implementation, you would need to:
// 1. Properly import the actual menu file/structure
// 2. Implement the menu building logic properly
// 3. Add proper IPC communication for each menu item
// 4. Handle menu item enablement based on backend state
//
// The implementation should follow Electron menu patterns and integrate with the existing
// menu system in the application
//
// This is a placeholder to show the structure needed, but the actual file would need
// to be integrated with the existing ElectronMenu.ts system in the codebase