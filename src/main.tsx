import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AppDataProvider } from './state/AppDataProvider';
import { ToastProvider } from './state/ToastProvider';
import './styles/index.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <AppDataProvider>
          <App />
        </AppDataProvider>
      </ToastProvider>
    </HashRouter>
  </StrictMode>,
);
