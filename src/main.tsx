import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/RecoveryScreen';
import { AppDataProvider } from './state/AppDataProvider';
import { ToastProvider } from './state/ToastProvider';
import { WorkoutAlertsProvider } from './state/WorkoutAlertsProvider';
import './styles/index.css';

if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void NativeApp.exitApp();
  });
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <ToastProvider>
          <AppDataProvider>
            <WorkoutAlertsProvider>
              <App />
            </WorkoutAlertsProvider>
          </AppDataProvider>
        </ToastProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);
