import React from 'react';
import { createRoot } from 'react-dom/client';
import { FengshenDownloadCenter } from '../../src/components/FengshenDownloadCenter';

// Isolated browser fixture. All API requests are intercepted by the smoke test.
createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-slate-950 p-4 sm:p-6 light:bg-slate-100">
    <FengshenDownloadCenter workspaceId="ui-fixture" apiFetch={(url, init) => fetch(url, init)}
      onOpenFengshenLogin={() => { document.body.dataset.loginOpened = 'true'; }} />
  </main>,
);
