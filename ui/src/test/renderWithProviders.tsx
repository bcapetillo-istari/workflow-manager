import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { AppConfig } from '../config';
import type { IstariGateway } from '../gateway/types';
import { AuthContextProvider } from '../auth/AuthContext';
import { DevTokenAuth } from '../auth/DevTokenAuth';
import { GatewayProvider } from '../gateway/GatewayContext';
import { MockGateway } from '../gateway/mock/MockGateway';
import { ConfigProvider } from '../layout/ConfigContext';

export const testConfig: AppConfig = {
  registryUrl: 'https://registry.test',
  istariWebUrl: 'https://istari.test',
  workflowManagerSystemId: 'sys-wm',
  workflowManagerRunsSystemId: 'sys-runs',
  devAuth: true,
};

export function makeMockGateway(): MockGateway {
  return new MockGateway({
    workflowManagerSystemId: testConfig.workflowManagerSystemId,
    workflowManagerRunsSystemId: testConfig.workflowManagerRunsSystemId,
    istariWebUrl: testConfig.istariWebUrl,
  });
}

export function renderWithProviders(
  ui: ReactElement,
  opts: {
    gateway?: IstariGateway;
    auth?: DevTokenAuth;
    route?: string;
    config?: AppConfig;
  } & RenderOptions = {},
) {
  const gateway = opts.gateway ?? makeMockGateway();
  const auth = opts.auth ?? new DevTokenAuth();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider config={opts.config ?? testConfig}>
      <AuthContextProvider provider={auth}>
        <GatewayProvider gateway={gateway}>
          <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[opts.route ?? '/']}>{children}</MemoryRouter>
          </QueryClientProvider>
        </GatewayProvider>
      </AuthContextProvider>
    </ConfigProvider>
  );
  return { gateway, auth, queryClient, ...render(ui, { wrapper: Wrapper, ...opts }) };
}
