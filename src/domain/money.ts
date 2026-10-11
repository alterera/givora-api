export function shippingPaise(
  subtotalPaise: number,
  flatPaise: number,
  freeAbovePaise: number,
): number {
  if (freeAbovePaise > 0 && subtotalPaise >= freeAbovePaise) return 0;
  return Math.max(0, flatPaise);
}

export function paiseToRupees(paise: number): number {
  return Number((paise / 100).toFixed(2));
}

export function formatInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(paise / 100);
}
