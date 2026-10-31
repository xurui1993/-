import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// 旧版个人空间把设置写在 personal:<账号>: 前缀下；改为单工作台后原地还原。
function restorePrefixedStorage() {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const store = window[name];
      const owners = new Set<string>();
      for (let i = 0; i < store.length; i++) {
        const match = /^personal:([a-f0-9]{32}):(.+)$/.exec(store.key(i) || '');
        if (match) owners.add(match[1]);
      }
      if (owners.size !== 1) continue;
      const prefix = `personal:${[...owners][0]}:`;
      for (let i = store.length - 1; i >= 0; i--) {
        const key = store.key(i) || '';
        if (!key.startsWith(prefix)) continue;
        const plain = key.slice(prefix.length);
        if (plain.startsWith('__personal_') || plain === '__migrated') continue;
        store.setItem(plain, store.getItem(key) as string);
      }
    } catch { /* 存储不可用时保持原样 */ }
  }
}

restorePrefixedStorage();
createRoot(document.getElementById('root')!).render(<App />);
