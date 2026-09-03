import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);

// Export a standard setup function for tests
export function setupMsw() {
  server.listen({ onUnhandledRequest: 'bypass' });
  console.log('[QA MSW] Mock Service Worker started');
}

export function teardownMsw() {
  server.close();
}
