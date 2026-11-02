import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/react.css';
import './styles/shell.css';
import './styles/map.css';
import './styles/dossier.css';
import './styles/views.css';
import App from './App';
import { installChunkReload } from './app/staleChunks';

// sessionStorage is read lazily: in a sandboxed frame even touching it throws, and installChunkReload handles that.
const session = { getItem: (k: string) => sessionStorage.getItem(k), setItem: (k: string, v: string) => sessionStorage.setItem(k, v) } as Storage;
installChunkReload(window, { reload: () => location.reload(), storage: session, now: Date.now });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
