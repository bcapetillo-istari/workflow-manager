import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import './index.css';
import App from './App';
import { loadConfig, type AppConfig } from './config';
import type { AuthProvider } from './auth/types';
import { DevTokenAuth } from './auth/DevTokenAuth';
import { isUnauthorized } from './auth/unauthorized';
import type { IstariGateway } from './gateway/types';
import { MockGateway } from './gateway/mock/MockGateway';
import { RestGateway } from './gateway/rest';
import { devObjectStoreRewrite } from './gateway/rest/devObjectStoreProxy';

function createGateway(config: AppConfig, auth: AuthProvider): IstariGateway {
  const useMock = config.devAuth && new URLSearchParams(window.location.search).get('mock') === '1';
  if (useMock) {
    return new MockGateway({
      workflowManagerSystemId: config.workflowManagerSystemId,
      workflowManagerRunsSystemId: config.workflowManagerRunsSystemId,
      istariWebUrl: config.istariWebUrl,
      latencyMs: 250,
    });
  }
  return new RestGateway({
    registryUrl: config.registryUrl,
    istariWebUrl: config.istariWebUrl,
    getToken: () => auth.getToken(),
    // Dev server only: route presigned object-store URLs through the Vite proxy (see devObjectStoreProxy.ts).
    rewriteObjectStoreUrl: import.meta.env.DEV ? devObjectStoreRewrite(import.meta.env.BASE_URL) : undefined,
  });
}

/** Any 401 from the gateway signs the user out, which returns them to the credential box. */
function createQueryClient(auth: AuthProvider): QueryClient {
  const onError = (error: unknown) => {
    if (isUnauthorized(error)) auth.signOut();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}

async function bootstrap() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const config = await loadConfig();
    const auth = new DevTokenAuth({ persist: config.devAuth });
    const gateway = createGateway(config, auth);
    const queryClient = createQueryClient(auth);
    root.render(
      <StrictMode>
        <App config={config} auth={auth} gateway={gateway} queryClient={queryClient} />
      </StrictMode>,
    );
  } catch (err) {
    root.render(
      <div className="mx-auto mt-16 max-w-lg rounded-[var(--radius-card)] border border-danger/20 bg-danger-soft/60 p-6 text-sm text-ink-700">
        <p className="font-semibold text-danger">Workflow Manager could not start.</p>
        <p className="mt-1">{err instanceof Error ? err.message : String(err)}</p>
      </div>,
    );
  }
}

void bootstrap();
