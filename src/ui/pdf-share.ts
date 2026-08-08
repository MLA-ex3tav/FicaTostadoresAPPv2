import type { SolicitudRemota } from "../lib/web-api";
import { descargarPdf, type CotizacionPdf } from "../services/cotizacion-pdf";
import { showToast } from "./toast";
import { openPdfViewer } from "./pdf-viewer";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function baseText(pdf: CotizacionPdf): string {
  return `Hola, te comparto el documento ${pdf.fileName} de Tostadores Fica.`;
}

/**
 * Comparte el PDF de una cotización u OT: descarga el archivo y, si el cliente
 * tiene teléfono o correo, abre WhatsApp/correo con el documento adjunto listo.
 */
export async function compartirPdf(
  item: SolicitudRemota,
  pdf: CotizacionPdf,
): Promise<void> {
  descargarPdf(pdf);

  const phone = asString(item.clientPhone);
  const email = asString(item.clientEmail);
  const text = encodeURIComponent(baseText(pdf));

  if (phone) {
    window.open(`https://wa.me/?text=${text}`, "_blank");
    showToast({
      title: "PDF listo para compartir",
      message: `El archivo ${pdf.fileName} se descargó. Se abrió WhatsApp con el mensaje; adjunta el PDF y envíalo a ${phone}.`,
      tone: "success",
      icon: "fileText",
      durationMs: 8000,
    });
    return;
  }

  if (email) {
    const subject = encodeURIComponent(`Cotización ${pdf.fileName} · Empresas Fica`);
    const body = encodeURIComponent(baseText(pdf));
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
    showToast({
      title: "PDF listo para compartir",
      message: `El archivo ${pdf.fileName} se descargó. Se abrió el correo para ${email}; adjunta el PDF y envía.`,
      tone: "success",
      icon: "fileText",
      durationMs: 8000,
    });
    return;
  }

  showToast({
    title: "PDF descargado",
    message: `El archivo ${pdf.fileName} se descargó. Compártelo manualmente desde tu carpeta de Descargas.`,
    tone: "success",
    icon: "fileText",
    durationMs: 8000,
    actions: [{ label: "Ver PDF", onClick: () => openPdfViewer(pdf), primary: true }],
  });
}
