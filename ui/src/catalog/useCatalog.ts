import { useQuery } from '@tanstack/react-query';
import type { CatalogEntry, LoadedManifest } from '../manifest/types';
import { useGateway } from '../gateway/GatewayContext';
import { useConfig } from '../layout/ConfigContext';
import { loadCatalog } from './loadCatalog';

export function catalogQueryKey(systemId: string) {
  return ['catalog', systemId] as const;
}

export function useCatalog() {
  const gateway = useGateway();
  const config = useConfig();
  return useQuery({
    queryKey: catalogQueryKey(config.workflowManagerSystemId),
    queryFn: () => loadCatalog(gateway, config.workflowManagerSystemId),
    staleTime: 60_000,
  });
}

export function findWorkflow(entries: CatalogEntry[] | undefined, key: string): LoadedManifest | undefined {
  return entries?.find((e): e is LoadedManifest => e.ok && e.manifest.key === key);
}
