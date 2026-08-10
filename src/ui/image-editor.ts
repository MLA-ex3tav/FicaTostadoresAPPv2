import { subirImagenProducto } from "../lib/web-api";
import { showToast } from "./toast";

export interface ImageEditorResult {
  productUrl: string;
  carouselUrl: string;
}

export type ImageEditorView = "product" | "carousel";

/** Máximo ancho según variante (igual que la web: 1200px producto, 2400px carrusel). */
function maxWidthForVariant(variant: ImageEditorView): number {
  return variant === "carousel" ? 2400 : 1200;
}

/** Convierte un File de imagen a WebP usando canvas (WebView2), comprimiendo al máximo. */
function convertToWebP(
  file: File,
  variant: ImageEditorView,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      const maxWidth = maxWidthForVariant(variant);
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Comprimir al máximo: calidad adaptativa hasta que pese menos de ~450 KB
      // o se alcance la calidad mínima.
      const qualities = [0.75, 0.6, 0.45];
      let attempt = 0;
      let done = false;

      const tryQuality = (): void => {
        if (done || attempt >= qualities.length) {
          done = true;
          return;
        }
        const quality = qualities[attempt];
        attempt += 1;
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              done = true;
              resolve(null);
              return;
            }
            if (blob.size <= 450 * 1024 || attempt >= qualities.length) {
              done = true;
              resolve(blob);
            } else {
              tryQuality();
            }
          },
          "image/webp",
          quality,
        );
      };

      tryQuality();
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * Procesa un archivo de imagen: lo convierte a WebP en el cliente (con
 * compresión adaptativa) y lo sube a la web (Vercel Blob).
 * `view` indica la variante: "product" (3:2) o "carousel" (5:2).
 */
export async function procesarImagenSubida(
  file: File,
  view: ImageEditorView = "product",
): Promise<ImageEditorResult | null> {
  if (!file.type.startsWith("image/")) {
    showToast({ title: "Formato no válido", message: "Elige una imagen (JPG, PNG o WebP).", tone: "warning" });
    return null;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast({ title: "Imagen muy grande", message: "Máximo 5 MB.", tone: "warning" });
    return null;
  }

  try {
    const webp = await convertToWebP(file, view);
    if (!webp) {
      throw new Error("No se pudo convertir la imagen a WebP");
    }

    const result = await subirImagenProducto(webp, view);
    if (!result.ok || !result.data?.url) {
      throw new Error(result.error ?? "No se pudo subir la imagen");
    }

    const url = result.data.url;
    return view === "carousel"
      ? { productUrl: "", carouselUrl: url }
      : { productUrl: url, carouselUrl: "" };
  } catch (error) {
    showToast({
      title: "Error al subir imagen",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
    return null;
  }
}
