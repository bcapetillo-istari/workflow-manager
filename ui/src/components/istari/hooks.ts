import { useQuery } from '@tanstack/react-query';
import { useGateway } from '../../gateway/GatewayContext';

export function useResourceSearch(
  term: string,
  filter: { extensions?: string[]; systemId?: string },
  enabled = true,
) {
  const gateway = useGateway();
  return useQuery({
    queryKey: ['resources', 'search', term, filter.extensions ?? null, filter.systemId ?? null],
    queryFn: () =>
      gateway.searchResources({
        name: term || undefined,
        extensions: filter.extensions,
        systemId: filter.systemId,
        size: 25,
      }),
    enabled,
    staleTime: 30_000,
  });
}

export function useRevisions(resourceId: string | undefined) {
  const gateway = useGateway();
  return useQuery({
    queryKey: ['resources', resourceId, 'revisions'],
    queryFn: () => gateway.listRevisions(resourceId!),
    enabled: !!resourceId,
    staleTime: 60_000,
  });
}

export function useSystems() {
  const gateway = useGateway();
  return useQuery({
    queryKey: ['systems'],
    queryFn: () => gateway.listSystems({ size: 100 }),
    staleTime: 60_000,
  });
}

export function useBranches(systemId: string | undefined) {
  const gateway = useGateway();
  return useQuery({
    queryKey: ['systems', systemId, 'branches'],
    queryFn: () => gateway.listBranches(systemId!),
    enabled: !!systemId,
    staleTime: 60_000,
  });
}

export function useAuthSecrets(secretType: string | undefined) {
  const gateway = useGateway();
  return useQuery({
    queryKey: ['auth-secrets', secretType ?? null],
    queryFn: () => gateway.listAuthSecrets(secretType ? { secretType } : undefined),
    staleTime: 60_000,
  });
}
