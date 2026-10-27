import { createContext, useContext, type ReactNode } from 'react';
import type { IstariGateway } from './types';

const GatewayContext = createContext<IstariGateway | null>(null);

export function GatewayProvider({ gateway, children }: { gateway: IstariGateway; children: ReactNode }) {
  return <GatewayContext.Provider value={gateway}>{children}</GatewayContext.Provider>;
}

export function useGateway(): IstariGateway {
  const ctx = useContext(GatewayContext);
  if (!ctx) throw new Error('useGateway must be used inside <GatewayProvider>');
  return ctx;
}
