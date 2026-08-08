export interface CompanyData {
  name: string;
  taxId: string;
  address: string;
  city: string;
  region: string;
  country: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  giro: string;
  bankName: string;
  bankAccount: string;
}

const STORAGE_KEY = "fica.company.data";

export const DEFAULT_FICA: CompanyData = {
  name: "EMPRESAS FICA LTDA",
  taxId: "76.683.592-9",
  address: "SAN RAMON PS39 LTD12-18",
  city: "PADRE LAS CASAS",
  region: "REGION DE LA ARAUCANIA",
  country: "CHILE",
  zip: "4780000",
  phone: "+56 9 9002 0089",
  email: "administracion@tostadoresfica.cl",
  website: "www.tostadoresfica.cl",
  giro: "FABRICA DE MAQUINARIA PARA FRUTOS SECOS",
  bankName: "BANCO SCOTIABANK",
  bankAccount: "CUENTA CORRIENTE 979706529",
};

/** Devuelve los datos guardados o, si no hay nada guardado, los de FICA. */
export function getCompanyData(): CompanyData {
  return { ...DEFAULT_FICA, ...(loadCompany() ?? {}) };
}

export function loadCompany(): CompanyData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompanyData;
    if (!parsed || typeof parsed !== "object" || !parsed.name) return null;
    return { ...DEFAULT_FICA, ...parsed };
  } catch {
    return null;
  }
}

export function saveCompany(data: CompanyData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
