export interface ProductColorOption {
  id: string;
  name: string;
  hex: string;
}

/** Colores oficiales Fica Tostadores (catálogo de pintura), iguales a los de la web. */
export const PRODUCT_COLORS: ProductColorOption[] = [
  { id: "azul", name: "Azul", hex: "#1e3a5f" },
  { id: "verde-claro", name: "Verde claro", hex: "#8fbc8f" },
  { id: "rojo-berries", name: "Rojo Berries", hex: "#a61b2e" },
  { id: "turquesa", name: "Turquesa", hex: "#3d8b8b" },
  { id: "amarillo", name: "Amarillo", hex: "#d4a017" },
  { id: "negro-maqui", name: "Negro Maqui", hex: "#2b2b2b" },
  { id: "blanco", name: "Blanco", hex: "#e8e8e8" },
  { id: "naranjo-fica", name: "Naranjo Fica Tostadores", hex: "#e85d04" },
  { id: "verde-pistacho", name: "Verde Pistacho", hex: "#8fb339" },
  { id: "celeste-quandong", name: "Celeste Quandong", hex: "#5eb3d9" },
  { id: "dorado-almendra", name: "Dorado Almendra", hex: "#c4a574" },
  { id: "cobre-albaricoque", name: "Cobre Albaricoque", hex: "#b87333" },
  { id: "cafe-avellana", name: "Café Avellana", hex: "#5c4033" },
];

export const DEFAULT_PRODUCT_COLOR_ID = "naranjo-fica";

export function getProductColorById(id: string | null | undefined): ProductColorOption | undefined {
  if (!id) return undefined;
  return PRODUCT_COLORS.find((color) => color.id === id);
}

export function getProductColorLabel(id: string | null | undefined): string | null {
  return getProductColorById(id)?.name ?? null;
}
