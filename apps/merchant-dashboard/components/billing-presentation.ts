export function canPersistCatalogSelection(subscriptionStatus: string): boolean {
  return subscriptionStatus === "PENDING_ACTIVATION";
}
