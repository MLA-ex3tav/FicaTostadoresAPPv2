import { jsPDF } from "jspdf";
import type { SolicitudRemota } from "../lib/web-api";
import {
  findProducto,
  getPrecioLocal,
  getCatalogo,
  loadCatalogo,
} from "./catalog";
import { showToast } from "../ui/toast";
import { openPdfViewer } from "../ui/pdf-viewer";
import { getCompanyData } from "../lib/company";
import {
  readCachedPdf,
  writeCachedPdf,
  deleteCachedPdf,
} from "./pdf-cache";

type RGB = [number, number, number];

const COLOR_PRIMARY: RGB = [232, 93, 4];
const COLOR_DARK: RGB = [28, 28, 32];
const COLOR_LIGHT_BG: RGB = [248, 248, 250];
const COLOR_BORDER: RGB = [220, 218, 212];
const COLOR_TEXT_DARK: RGB = [30, 30, 35];
const COLOR_TEXT_MUTED: RGB = [105, 100, 95];
const COLOR_WHITE: RGB = [255, 255, 255];

function text(value: unknown, fallback = "-"): string {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function moneyCLP(value: number): string {
  const rounded = Math.round(value);
  return `$ ${rounded.toLocaleString("es-CL")}`;
}

function dateLabel(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

function comunaFrom(address: string): string {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : "";
}

function numberFrom(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

async function imageDataUrl(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function lineItem(item: unknown): {
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
} {
  const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const product = findProducto(record.productId, record.name) ?? undefined;
  const quantity = Math.max(1, numberFrom(record.quantity, record.cantidad, 1));
  const unitPrice = product ? getPrecioLocal(product) : numberFrom(record.price, record.precio, 0);

  return {
    code: text(record.productId ?? product?.id),
    name: text(record.name ?? product?.name),
    quantity,
    unitPrice,
  };
}

export interface CotizacionPdf {
  blob: Blob;
  fileName: string;
  url: string;
  item: SolicitudRemota;
}

/** Fingerprint del contenido de la cotización para saber si un PDF guardado sigue vigente. */
function fingerprint(item: SolicitudRemota): string {
  const productos = (Array.isArray(item.products) ? item.products : [])
    .map((product) => {
      const record = product && typeof product === "object"
        ? (product as Record<string, unknown>)
        : {};
      return [
        record.productId ?? record.id ?? "",
        record.name ?? "",
        record.quantity ?? "",
        record.price ?? record.precio ?? record.unitPrice ?? "",
      ].join("|");
    })
    .join("#");
  return JSON.stringify({
    id: String(item.id),
    name: item.clientName,
    rut: item.clientRut,
    address: item.clientAddress,
    comuna: item.clientComuna,
    message: item.message,
    productos,
  });
}

/** Caché en memoria: reutiliza el PDF si la cotización no cambió. */
const pdfCache = new Map<string, { fingerprint: string; pdf: CotizacionPdf }>();

function pdfFileName(item: SolicitudRemota): string {
  return `COT-${text(item.id, "SIN-NUMERO").toUpperCase()}.pdf`;
}

/**
 * Genera (o reutiliza) el PDF de la cotización. Si el PDF ya existe para el mismo
 * contenido, devuelve el guardado sin regenerarlo, marcando `cacheado: true`.
 * La caché es persistente (IndexedDB): sobrevive reinicios de la app.
 */
export async function obtenerCotizacionPdf(
  item: SolicitudRemota,
): Promise<{ pdf: CotizacionPdf; cacheado: boolean }> {
  const finger = fingerprint(item);
  const cacheKey = `cot:${item.id}`;

  const cached = pdfCache.get(cacheKey);
  if (cached && cached.fingerprint === finger) {
    return { pdf: cached.pdf, cacheado: true };
  }

  const persistedBlob = await readCachedPdf(cacheKey, finger);
  if (persistedBlob) {
    const pdf: CotizacionPdf = {
      blob: persistedBlob,
      fileName: pdfFileName(item),
      url: URL.createObjectURL(persistedBlob),
      item,
    };
    pdfCache.set(cacheKey, { fingerprint: finger, pdf });
    return { pdf, cacheado: true };
  }

  const pdf = await generarCotizacionPdf(item);
  pdfCache.set(cacheKey, { fingerprint: finger, pdf });
  void writeCachedPdf(cacheKey, finger, pdf.blob);
  return { pdf, cacheado: false };
}

/** Invalida el PDF cacheado de una cotización (tras edición local). */
export function invalidarCotizacionPdf(id: string): void {
  pdfCache.delete(`cot:${id}`);
  void deleteCachedPdf(`cot:${id}`);
}

/** Genera el PDF de la cotización replicando el diseño oficial de FICA en MAYÚSCULAS. */
export async function generarCotizacionPdf(item: SolicitudRemota): Promise<CotizacionPdf> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
  const margin = 14;

  let catalog = getCatalogo();
  if (catalog.length === 0) {
    try {
      catalog = await loadCatalogo();
    } catch {
      catalog = [];
    }
  }

  const rawProducts = Array.isArray(item.products)
    ? item.products.map((product) => lineItem(product))
    : [];

  const products = rawProducts.map((p) => {
    // El precio guardado en la app ya incluye IVA
    const unitPriceConIva = p.unitPrice;
    return {
      ...p,
      code: p.code.toUpperCase(),
      name: p.name.toUpperCase(),
      unitPriceConIva,
      totalConIva: unitPriceConIva * p.quantity,
    };
  });

  const totalConIva = products.reduce((sum, product) => sum + product.totalConIva, 0);

  const company = getCompanyData();
  const rawCompanyName = text(company.name, "EMPRESAS FICA LTDA").toUpperCase();
  const companyName = rawCompanyName.includes("TOSTADORES FICA") ? "EMPRESAS FICA LTDA" : rawCompanyName;
  const companyTaxId = text(company.taxId, "76.683.592-9").toUpperCase();
  const companyAddress = text(
    [company.address, company.city, company.region, company.country].filter(Boolean).join(" "),
    "SAN RAMON PS39 LTD12-18 PADRE LAS CASAS REGION DE LA ARAUCANIA, CHILE",
  ).toUpperCase();
  const companyPhone = text(company.phone, "+56 9 9002 0089").toUpperCase();
  const companyEmail = text(company.email, "ADMINISTRACION@TOSTADORESFICA.CL").toUpperCase();
  const companyGiro = text(company.giro, "FABRICA DE MAQUINARIA PARA FRUTOS SECOS").toUpperCase();
  const companyBank = text(company.bankName, "BANCO SCOTIABANK").toUpperCase();
  const companyAccount = text(company.bankAccount, "CUENTA CORRIENTE 979706529").toUpperCase();

  const clientName = text(item.clientName, "SIN CLIENTE REGISTRADO").toUpperCase();
  const clientRut = text(item.clientRut, "N/A").toUpperCase();
  const clientPhone = text(item.clientPhone, "N/A").toUpperCase();
  const clientEmail = text(item.clientEmail, "N/A").toUpperCase();
  const clientAddress = text(item.clientAddress, "POR ACORDAR CON EL CLIENTE").toUpperCase();
  const clientComuna = (comunaFrom(clientAddress) || text(item.clientComuna, "N/A")).toUpperCase();

  // ── 1. Encabezado: logo + nombre empresa (izquierda) / COTIZACIÓN (derecha) ──
  const logo = await imageDataUrl("/assets/logo.webp");
  let headerTextX = margin;
  if (logo) {
    doc.addImage(logo, "PNG", margin, 10, 20, 20);
    headerTextX = margin + 24;
  }

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLOR_DARK);
  doc.setFontSize(13);
  doc.text(companyName.slice(0, 40), headerTextX, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR_TEXT_MUTED);
  doc.text(`RUT: ${companyTaxId}`, headerTextX, 23.5);
  doc.text(`GIRO: ${companyGiro}`.slice(0, 65), headerTextX, 27.5);
  doc.text(`DIRECCIÓN: ${companyAddress}`.slice(0, 85), headerTextX, 31.5);

  // Banner COTIZACIÓN
  const docLabel = "COTIZACIÓN";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...COLOR_PRIMARY);
  doc.text(docLabel, pageWidth - margin, 20, { align: "right" });

  doc.setFontSize(8);
  doc.setTextColor(...COLOR_DARK);
  doc.text(`Nº ${text(item.id).toUpperCase().slice(0, 16)}`, pageWidth - margin, 27, { align: "right" });
  doc.text(`FECHA EMISIÓN: ${dateLabel()}`, pageWidth - margin, 31.5, { align: "right" });
  doc.text("VALIDEZ: 15 DÍAS", pageWidth - margin, 35.5, { align: "right" });

  doc.setDrawColor(...COLOR_PRIMARY);
  doc.setLineWidth(0.5);
  doc.line(margin, 39, pageWidth - margin, 39);

  // ── 2. Datos del Cliente ──
  const clientY = 43;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...COLOR_BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, clientY, pageWidth - margin * 2, 30, 2, 2, "FD");

  doc.setFillColor(...COLOR_PRIMARY);
  doc.rect(margin, clientY, 2.5, 30, "F");

  doc.setTextColor(...COLOR_PRIMARY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("DATOS DEL CLIENTE", margin + 6, clientY + 6);

  const clientLeftX = margin + 6;
  const clientRightX = pageWidth / 2 + 6;

  doc.setTextColor(...COLOR_TEXT_DARK);
  doc.setFontSize(8);

  doc.setFont("helvetica", "bold");
  doc.text("NOMBRE:", clientLeftX, clientY + 12.5);
  doc.setFont("helvetica", "normal");
  doc.text(clientName.slice(0, 40), clientLeftX + 20, clientY + 12.5);

  doc.setFont("helvetica", "bold");
  doc.text("DIRECCIÓN:", clientLeftX, clientY + 18.5);
  doc.setFont("helvetica", "normal");
  doc.text(clientAddress.slice(0, 48), clientLeftX + 20, clientY + 18.5);

  doc.setFont("helvetica", "bold");
  doc.text("E-MAIL:", clientLeftX, clientY + 24.5);
  doc.setFont("helvetica", "normal");
  doc.text(clientEmail.slice(0, 44), clientLeftX + 24, clientY + 24.5);

  doc.setFont("helvetica", "bold");
  doc.text("RUT:", clientRightX, clientY + 12.5);
  doc.setFont("helvetica", "normal");
  doc.text(clientRut.slice(0, 20), clientRightX + 12, clientY + 12.5);

  doc.setFont("helvetica", "bold");
  doc.text("COMUNA:", clientRightX, clientY + 18.5);
  doc.setFont("helvetica", "normal");
  doc.text(clientComuna.slice(0, 30), clientRightX + 20, clientY + 18.5);

  doc.setFont("helvetica", "bold");
  doc.text("TELÉFONO:", clientRightX, clientY + 24.5);
  doc.setFont("helvetica", "normal");
  doc.text(clientPhone.slice(0, 24), clientRightX + 20, clientY + 24.5);

  // ── 3. Tabla de Productos ──
  const tableY = clientY + 36;
  const colX = [margin, 96, 126, 150, 162];
  const colW = [82, 30, 24, 12, 34];
  const tableW = pageWidth - margin * 2;

  doc.setFillColor(...COLOR_DARK);
  doc.roundedRect(margin, tableY, tableW, 8, 1, 1, "F");
  doc.setTextColor(...COLOR_WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);

  doc.text("PRODUCTO", colX[0] + 3, tableY + 5.5);
  doc.text("CÓDIGO", colX[1] + 3, tableY + 5.5);
  doc.text("VALOR UNIDAD", colX[2] + colW[2] - 3, tableY + 5.5, { align: "right" });
  doc.text("CANTIDAD", colX[3] + colW[3] / 2, tableY + 5.5, { align: "center" });
  doc.text("VALOR TOTAL", colX[4] + colW[4] - 3, tableY + 5.5, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOR_TEXT_DARK);

  const displayRows = products.length > 0
    ? products
    : [{ code: "FT-GEN", name: "SERVICIO DE FABRICACIÓN DE MAQUINARIA", quantity: 1, unitPriceConIva: totalConIva || 0, totalConIva: totalConIva || 0 }];

  let currentY = tableY + 8;

  displayRows.forEach((product, index) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const nameLines: string[] = doc.splitTextToSize(product.name, colW[0] - 4);
    const lineCount = nameLines.length;
    const rowH = Math.max(9, 6 + (lineCount - 1) * 4.5);

    const bg: RGB = index % 2 === 0 ? COLOR_WHITE : COLOR_LIGHT_BG;

    doc.setFillColor(...bg);
    doc.rect(margin, currentY, tableW, rowH, "F");
    doc.setDrawColor(...COLOR_BORDER);
    doc.setLineWidth(0.2);
    doc.line(margin, currentY + rowH, margin + tableW, currentY + rowH);

    doc.setTextColor(...COLOR_TEXT_DARK);
    nameLines.forEach((lineText, lineIdx) => {
      doc.text(lineText, colX[0] + 3, currentY + 5.5 + lineIdx * 4.5);
    });

    const textY = currentY + 5.5;
    doc.text(product.code.slice(0, 16), colX[1] + 3, textY);
    doc.text(moneyCLP(product.unitPriceConIva), colX[2] + colW[2] - 3, textY, { align: "right" });
    doc.text(String(product.quantity), colX[3] + colW[3] / 2, textY, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.text(moneyCLP(product.totalConIva), colX[4] + colW[4] - 3, textY, { align: "right" });
    doc.setFont("helvetica", "normal");

    currentY += rowH;
  });

  // ── 4. Totales: VALOR TOTAL (IVA INCLUIDO) ──
  const totalsY = currentY + 4;
  const totalsW = 72;
  const totalsX = pageWidth - margin - totalsW;
  const totalsH = 14;

  doc.setFillColor(...COLOR_PRIMARY);
  doc.setDrawColor(...COLOR_PRIMARY);
  doc.roundedRect(totalsX, totalsY, totalsW, totalsH, 1.5, 1.5, "F");

  doc.setTextColor(...COLOR_WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("VALOR TOTAL (IVA INCLUIDO)", totalsX + 5, totalsY + 5.5);
  doc.setFontSize(11);
  doc.text(moneyCLP(totalConIva), totalsX + totalsW - 5, totalsY + 10.5, { align: "right" });

  // ── 5. Observación ──
  const notesY = totalsY + totalsH + 5;
  const notesH = 14;
  doc.setFillColor(...COLOR_LIGHT_BG);
  doc.setDrawColor(...COLOR_BORDER);
  doc.roundedRect(margin, notesY, pageWidth - margin * 2, notesH, 2, 2, "FD");

  doc.setTextColor(...COLOR_DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("OBSERVACIÓN:", margin + 4, notesY + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOR_TEXT_MUTED);
  doc.text(
    text(item.message, "SIN OBSERVACIONES ADICIONALES REGISTRADAS.").toUpperCase().slice(0, 85),
    margin + 4,
    notesY + 10.5,
  );

  // ── 6. Bloques de Información Inferior: DATOS EMPRESA / CUENTA BANCARIA ──
  const blockY = notesY + notesH + 5;
  const blockH = 34;
  const blockW = (pageWidth - margin * 2 - 6) / 2;

  const drawEmpresaBlock = (x: number, title: string, lines: Array<{ text: string; isBold?: boolean }>) => {
    doc.setFillColor(...COLOR_LIGHT_BG);
    doc.setDrawColor(...COLOR_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, blockY, blockW, blockH, 2, 2, "FD");

    doc.setFillColor(...COLOR_DARK);
    doc.rect(x, blockY, 2.5, blockH, "F");

    doc.setTextColor(...COLOR_DARK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(title, x + 6, blockY + 5.5);

    doc.setTextColor(...COLOR_TEXT_DARK);

    let lineY = blockY + 10.5;
    lines.forEach((item) => {
      doc.setFont("helvetica", item.isBold ? "bold" : "normal");
      doc.setFontSize(item.isBold ? 7.2 : 6.8);
      const wrapped: string[] = doc.splitTextToSize(item.text, blockW - 10);
      wrapped.forEach((subLine) => {
        if (lineY <= blockY + blockH - 2) {
          doc.text(subLine, x + 6, lineY);
          lineY += 4.5;
        }
      });
    });
  };

  drawEmpresaBlock(margin, "DATOS EMPRESA:", [
    { text: companyName, isBold: true },
    { text: `RUT: ${companyTaxId}` },
    { text: `GIRO: ${companyGiro}` },
    { text: `CASA MATRIZ: ${companyAddress}` },
  ]);

  drawEmpresaBlock(margin + blockW + 6, "CUENTA BANCARIA:", [
    { text: companyName, isBold: true },
    { text: `RUT: ${companyTaxId}` },
    { text: companyBank },
    { text: companyAccount },
    { text: `EMAIL: ${companyEmail}` },
  ]);

  // ── 7. Nota de plazos ──
  const noteY = blockY + blockH + 5;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_TEXT_MUTED);
  doc.text(
    "LA FÁBRICA POSEE PLAZOS DE ENTREGA DE 20-25 DÍAS QUE PUEDEN VARIAR 5 DÍAS HÁBILES, EN CONSECUENCIA DE LOS PLAZOS DE ENTREGA DE COMPONENTES ESPECIALES DE PROVEEDORES NACIONALES E INTERNACIONALES.",
    margin,
    noteY,
    { maxWidth: pageWidth - margin * 2 },
  );

  // ── 8. Footer ──
  const footerY = pageHeight - 13;
  doc.setFillColor(...COLOR_DARK);
  doc.rect(0, footerY, pageWidth, 13, "F");

  doc.setTextColor(...COLOR_WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(`${companyName}  ·  RUT: ${companyTaxId}`.slice(0, 48), margin, footerY + 5.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`CASA MATRIZ: ${companyAddress}  |  TEL: ${companyPhone}`.slice(0, 74), margin, footerY + 10);

  doc.setFont("helvetica", "bold");
  doc.text("CONTACTO:", pageWidth - margin - 72, footerY + 5.5);
  doc.setFont("helvetica", "normal");
  doc.text(`${companyEmail}`.slice(0, 34), pageWidth - margin - 72, footerY + 10);

  const blob = doc.output("blob");
  const fileName = `COT-${text(item.id, "SIN-NUMERO").toUpperCase()}.pdf`;
  const url = URL.createObjectURL(blob);

  return { blob, fileName, url, item };
}

/** Descarga un PDF generado, notifica al usuario indicando la ubicación e integra apertura directa. */
export function descargarPdf(pdf: CotizacionPdf): void {
  const anchor = document.createElement("a");
  anchor.href = pdf.url;
  anchor.download = pdf.fileName;
  anchor.click();

  showToast({
    title: "Archivo Guardado",
    message: `El documento ${pdf.fileName} se guardó en tu carpeta de Descargas (Downloads).`,
    tone: "success",
    icon: "fileText",
    durationMs: 12000,
    actions: [
      {
        label: "Abrir documento",
        primary: true,
        onClick: () => openPdfViewer(pdf),
      },
    ],
  });
}

/** Libera la URL temporal de un PDF que ya no se necesita. */
export function liberarPdf(pdf: CotizacionPdf): void {
  URL.revokeObjectURL(pdf.url);
}

export {
  generarOtPdf as generarOrdenTrabajoPdf,
  obtenerOrdenTrabajoPdf,
  invalidarOrdenTrabajoPdf,
  descargarOtPdf,
  liberarOtPdf,
  type OtPdf,
} from "./ot-pdf";
