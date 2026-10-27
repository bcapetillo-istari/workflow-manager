import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import type { AppConfig } from './config';
import type { AuthProvider } from './auth/types';
import type { IstariGateway } from './gateway/types';
import { AuthContextProvider } from './auth/AuthContext';
import { GatewayProvider } from './gateway/GatewayContext';
import { ConfigProvider } from './layout/ConfigContext';
import { AppShell } from './layout/AppShell';
import { AuthGate } from './layout/AuthGate';
import { ErrorBoundary } from './layout/ErrorBoundary';
import { Catalog } from './pages/Catalog';
import { StartRun } from './pages/StartRun';
import { RunDetail } from './pages/RunDetail';
import { RunHistory } from './pages/RunHistory';
import { NotFound } from './pages/NotFound';

export interface AppProps {
  config: AppConfig;
  auth: AuthProvider;
  gateway: IstariGateway;
  queryClient: QueryClient;
  /** Router basename; defaults to Vite's BASE_URL without the trailing slash. */
  basename?: string;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Catalog />} />
        <Route path="workflows/:key" element={<StartRun />} />
        <Route path="runs" element={<RunHistory />} />
        <Route path="runs/:resourceId" element={<RunDetail />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App({ config, auth, gateway, queryClient, basename }: AppProps) {
  return (
    <ConfigProvider config={config}>
      <AuthContextProvider provider={auth}>
        <GatewayProvider gateway={gateway}>
          <QueryClientProvider client={queryClient}>
            <ErrorBoundary onUnauthorized={() => auth.signOut()}>
              <AuthGate>
                <BrowserRouter basename={basename ?? import.meta.env.BASE_URL.replace(/\/$/, '')}>
                  <AppRoutes />
                </BrowserRouter>
              </AuthGate>
            </ErrorBoundary>
          </QueryClientProvider>
        </GatewayProvider>
      </AuthContextProvider>
    </ConfigProvider>
  );
}
