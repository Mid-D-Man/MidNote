// Small, limited-range roman numeral conversion — just enough for list
// continuation (1..3999 covers any realistic list length many times
// over). Not a general-purpose numeral library.
const VALUES: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function toRoman(num: number): string {
  if (num <= 0 || num > 3999) return String(num);
  let n = num;
  let out = "";
  for (const [value, symbol] of VALUES) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}

const ROMAN_MAP: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function fromRoman(s: string): number | null {
  const upper = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(upper)) return null;
  let total = 0;
  for (let i = 0; i < upper.length; i++) {
    const cur = ROMAN_MAP[upper[i]];
    const next = ROMAN_MAP[upper[i + 1]];
    if (next && cur < next) total -= cur;
    else total += cur;
  }
  return total > 0 ? total : null;
}
