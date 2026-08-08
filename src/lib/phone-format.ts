export interface PhoneCountryInfo {
  code: string;
  name: string;
  flag: string;
  formatter: (digits: string) => string;
}

export interface PhoneFormatResult {
  formatted: string;
  country: PhoneCountryInfo | null;
}

function progressive(digits: string, groups: number[]): string {
  const parts: string[] = [];
  let index = 0;
  for (const size of groups) {
    if (index >= digits.length) break;
    const chunk = digits.slice(index, index + size);
    parts.push(chunk);
    index += size;
    if (chunk.length < size) break;
  }
  return parts.join(" ");
}

const cl = (digits: string): string => {
  if (digits.length >= 9 && digits[0] === "9") {
    return progressive(digits, [1, 4, 4]);
  }
  if (digits.length >= 8) {
    return progressive(digits, [2, 6]);
  }
  return progressive(digits, [1, 4, 4]);
};

const ar = (digits: string): string => {
  if (digits.length >= 11) return progressive(digits, [1, 2, 4, 4]);
  if (digits.length >= 10) return progressive(digits, [2, 4, 4]);
  return progressive(digits, [2, 4, 4]);
};

const pe = (digits: string): string => {
  if (digits.length >= 9 && digits[0] === "9") return progressive(digits, [1, 4, 4]);
  return progressive(digits, [2, 6]);
};

const co = (digits: string): string => {
  if (digits.length >= 10) return progressive(digits, [3, 3, 4]);
  return progressive(digits, [3, 3, 4]);
};

const mx = (digits: string): string => {
  if (digits.length >= 11) return progressive(digits, [2, 2, 4, 4]);
  if (digits.length >= 10) return progressive(digits, [2, 4, 4]);
  return progressive(digits, [2, 4, 4]);
};

const br = (digits: string): string => {
  if (digits.length >= 11) return progressive(digits, [2, 5, 4]);
  if (digits.length >= 10) return progressive(digits, [2, 4, 4]);
  return progressive(digits, [2, 4, 4]);
};

const bo = (digits: string): string => progressive(digits, [4, 4]);

const ec = (digits: string): string => {
  if (digits.length >= 9 && digits[0] === "9") return progressive(digits, [1, 4, 4]);
  return progressive(digits, [2, 6]);
};

const py = (digits: string): string => {
  if (digits.length >= 9) return progressive(digits, [3, 3, 3]);
  return progressive(digits, [3, 3, 3]);
};

const uy = (digits: string): string => {
  if (digits.length >= 8 && digits[0] === "9") return progressive(digits, [1, 3, 4]);
  return progressive(digits, [2, 6]);
};

const ve = (digits: string): string => progressive(digits, [3, 7]);

const us = (digits: string): string => {
  if (digits.length >= 10) return progressive(digits, [3, 3, 4]);
  return progressive(digits, [3, 3, 4]);
};

const es = (digits: string): string => progressive(digits, [3, 3, 3]);

const gb = (digits: string): string => {
  if (digits.length >= 10) return progressive(digits, [2, 4, 4]);
  return progressive(digits, [2, 4, 4]);
};

const de = (digits: string): string => progressive(digits, [3, 4, 4]);

export const PHONE_COUNTRIES: PhoneCountryInfo[] = [
  { code: "56", name: "Chile", flag: "🇨🇱", formatter: cl },
  { code: "54", name: "Argentina", flag: "🇦🇷", formatter: ar },
  { code: "591", name: "Bolivia", flag: "🇧🇴", formatter: bo },
  { code: "595", name: "Paraguay", flag: "🇵🇾", formatter: py },
  { code: "598", name: "Uruguay", flag: "🇺🇾", formatter: uy },
  { code: "593", name: "Ecuador", flag: "🇪🇨", formatter: ec },
  { code: "51", name: "Perú", flag: "🇵🇪", formatter: pe },
  { code: "57", name: "Colombia", flag: "🇨🇴", formatter: co },
  { code: "52", name: "México", flag: "🇲🇽", formatter: mx },
  { code: "55", name: "Brasil", flag: "🇧🇷", formatter: br },
  { code: "58", name: "Venezuela", flag: "🇻🇪", formatter: ve },
  { code: "34", name: "España", flag: "🇪🇸", formatter: es },
  { code: "44", name: "Reino Unido", flag: "🇬🇧", formatter: gb },
  { code: "49", name: "Alemania", flag: "🇩🇪", formatter: de },
  { code: "1", name: "EE. UU./Canadá", flag: "🇺🇸", formatter: us },
];

function stripNonDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function detectCountry(digits: string): PhoneCountryInfo | null {
  const byLength = [...PHONE_COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  return (
    byLength.find((country) => digits.startsWith(country.code)) ?? null
  );
}

/**
 * Formatea un número de teléfono detectando el país por su código internacional.
 * Acepta con o sin "+" (p. ej. "56912345678" o "+56 9 1234 5678").
 */
export function formatPhoneNumber(raw: string): PhoneFormatResult {
  const digits = stripNonDigits(raw);

  if (digits.length === 0) {
    return { formatted: "", country: null };
  }

  const country = detectCountry(digits);
  if (country) {
    const localDigits = digits.slice(country.code.length);
    const local = country.formatter(localDigits);
    return { formatted: `+${country.code} ${local}`.trim(), country };
  }

  return { formatted: digits, country: null };
}

export function countDigitsBefore(value: string, caret: number): number {
  let count = 0;
  for (let i = 0; i < caret && i < value.length; i++) {
    if (/\d/.test(value[i])) count++;
  }
  return count;
}

export function caretAfterDigits(value: string, targetDigits: number): number {
  let seen = 0;
  for (let i = 0; i < value.length; i++) {
    if (/\d/.test(value[i])) {
      seen++;
      if (seen > targetDigits) return i;
    }
  }
  return value.length;
}
