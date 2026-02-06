import { createContext, useContext, type ReactNode } from 'react';

export type TenantProfile = {
  tenantId: string;
  isAdmin: boolean;
  name?: string;
  uid?: string;
  email?: string;
};

const TenantContext = createContext<TenantProfile | null>(null);

export function TenantProvider({
  value,
  children,
}: {
  value: TenantProfile;
  children: ReactNode;
}) {
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantProfile {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used inside TenantProvider');
  return ctx;
}
