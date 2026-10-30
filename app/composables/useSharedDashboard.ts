import type { PublicDashboard, AdminDashboard } from '../../shared/contracts/public-dashboard'
export const useSharedDashboard = () =>
  useState<PublicDashboard | AdminDashboard | null>('nozoki-shared-dashboard', () => null)
