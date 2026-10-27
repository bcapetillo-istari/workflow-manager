import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { useGateway } from '../gateway/GatewayContext';

export function useCurrentUser() {
  const gateway = useGateway();
  const { token } = useAuth();
  return useQuery({
    queryKey: ['current-user', token],
    queryFn: () => gateway.currentUser(),
    enabled: token !== null,
    staleTime: Infinity,
    retry: false,
  });
}
