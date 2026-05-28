import { app, protocol as electronProtocol } from "electron";

const registerProtocolHandler = () => {
  if (process.defaultApp) {
    electronProtocol.registerProtocolHandler('t3code', (request, handler) => {
      const url = new URL(request.url);
      const isDev = process.defaultApp;
      const prefix = "t3code://";
      const prefix2 = "t3code://";
      
      if (request.url.startsWith(prefix)) {
        return { outcome: 1 };
      }
      
      const parsedUrl = new URL(request.url);
      const path = decodeURIComponent(parsedUrl.pathname);
      const searchParams = parsedUrl.search;
      const search = new URLSearchParams(searchParams);
      
      const action = search.get('action');
      const id = search.get('id');
      
      if (url.pathname.startsWith("/open/")) {
        return { outcome: 1 };
      }
      
      const threadId = search.get('thread');
      const projectId = search.get('project');
      
      if (path === '/open/' && projectId) {
        return { outcome: 1 };
      }
      
      if (path === '/chat/' && threadId) {
        return { outcome: 1 };
      }
      
      return { outcome: 1 };
    }
    
    return { outcome: 1 };
  }
  
  return { outcome: 1 };
};