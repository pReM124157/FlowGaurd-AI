export type Currency = "INR";

export type Money = Readonly<{
  amountMinor: number;
  currency: Currency;
}>;

export function money(amountMinor: number, currency: Currency = "INR"): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error(`Money amount must be a safe integer minor unit: ${amountMinor}`);
  }

  return Object.freeze({ amountMinor, currency });
}

export function assertNonNegative(value: Money, label: string): void {
  if (value.amountMinor < 0) {
    throw new Error(`${label} cannot be negative`);
  }
}

export function addMoney(...values: Money[]): Money {
  if (values.length === 0) return money(0);
  const currency = values[0].currency;
  const total = values.reduce((sum, value) => {
    assertSameCurrency(currency, value.currency);
    return sum + value.amountMinor;
  }, 0);
  return money(total, currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left.currency, right.currency);
  return money(left.amountMinor - right.amountMinor, left.currency);
}

export function negateMoney(value: Money): Money {
  return money(-value.amountMinor, value.currency);
}

export function assertSameCurrency(left: Currency, right: Currency): void {
  if (left !== right) {
    throw new Error(`Currency mismatch: ${left} != ${right}`);
  }
}

export function formatMoney(value: Money): string {
  const sign = value.amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(value.amountMinor);
  const rupees = Math.floor(absolute / 100);
  const paise = String(absolute % 100).padStart(2, "0");
  return `${sign}INR ${rupees}.${paise}`;
}
