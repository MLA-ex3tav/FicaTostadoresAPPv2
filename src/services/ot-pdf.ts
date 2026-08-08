import { jsPDF } from "jspdf";
import type { SolicitudRemota } from "../lib/web-api";
import { findProducto, getPrecioLocal, getCatalogo, loadCatalogo } from "./catalog";
import { showToast } from "../ui/toast";
import { openPdfViewer } from "../ui/pdf-viewer";
import { getCompanyData } from "../lib/company";
import {
  readCachedPdf,
  writeCachedPdf,
  deleteCachedPdf,
} from "./pdf-cache";

type RGB = [number, number, number];

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
const GRAY_MED: RGB = [127, 127, 127];
const GRAY_LIGHT: RGB = [231, 230, 230];
const GRAY_VLIGHT: RGB = [242, 242, 242];

const IVA_RATE = 0.19;

function text(value: unknown, fallback = ""): string {
  const result = String(value ?? "").trim();
  return result || fallback;
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

function moneyCLP(value: number): string {
  return `$ ${Math.round(value).toLocaleString("es-CL")}`;
}

function dateSlash(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function comunaFrom(address: string): string {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : "";
}

function box(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: RGB,
  lineWidth = 0.7,
): void {
  if (fill) {
    doc.setFillColor(...fill);
    doc.rect(x, y, w, h, "F");
  }
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(lineWidth);
  doc.rect(x, y, w, h, "S");
}

function cellText(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  value: string,
  opts: { bold?: boolean; align?: "left" | "center" | "right"; color?: RGB; size?: number } = {},
): void {
  const style = opts.bold ? "bold" : "normal";
  doc.setFont("helvetica", style);

  const strVal = String(value ?? "");
  const baseSize = opts.size ?? 8.4;
  const textWidth = (doc.getStringUnitWidth(strVal) * baseSize) / doc.internal.scaleFactor;
  let finalSize = baseSize;
  if (textWidth > w - 4 && strVal.length > 0) {
    finalSize = Math.max(5.5, baseSize * ((w - 4) / textWidth));
  }

  doc.setFontSize(finalSize);
  doc.setTextColor(...(opts.color ?? WHITE));
  const baseline = y + h - 2.2;
  if (opts.align === "center") {
    doc.text(strVal, x + w / 2, baseline, { align: "center" });
  } else if (opts.align === "right") {
    doc.text(strVal, x + w - 3, baseline, { align: "right" });
  } else {
    doc.text(strVal, x + 3, baseline);
  }
}

function otLineItem(record: unknown): {
  code: string;
  name: string;
  color: string;
  quantity: number;
  unitPrice: number;
} {
  const rec = record && typeof record === "object" ? (record as Record<string, unknown>) : {};
  const product = findProducto(rec.productId, rec.name) ?? undefined;
  const quantity = Math.max(1, numberFrom(rec.quantity, rec.cantidad, 1));
  const unitPrice = product
    ? getPrecioLocal(product)
    : numberFrom(rec.price, rec.precio, 0);

  return {
    code: text(rec.productId ?? product?.id).toUpperCase(),
    name: text(rec.name ?? product?.name).toUpperCase(),
    color: text(rec.selectedColor ?? rec.color, "").toUpperCase(),
    quantity,
    unitPrice,
  };
}

export interface OtPdf {
  blob: Blob;
  fileName: string;
  url: string;
  item: SolicitudRemota;
}

export async function generarOtPdf(item: SolicitudRemota): Promise<OtPdf> {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: [612, 1008] });

  let catalog = getCatalogo();
  if (catalog.length === 0) {
    try {
      catalog = await loadCatalogo();
    } catch {
      catalog = [];
    }
  }

  const products =
    Array.isArray(item.products) && item.products.length > 0
      ? item.products.map((product) => otLineItem(product))
      : [
          {
            code: "FT-GEN",
            name: "SERVICIO DE FABRICACIÓN DE MAQUINARIA",
            color: "",
            quantity: 1,
            unitPrice: 0,
          },
        ];

  const subtotal = products.reduce((sum, p) => sum + p.quantity * p.unitPrice, 0);
  const neto = Math.round(subtotal / (1 + IVA_RATE));
  const iva = subtotal - neto;
  const total = subtotal;

  const company = getCompanyData();
  const rawCompanyName = text(company.name, "EMPRESAS FICA LTDA.").toUpperCase();
  const companyName = rawCompanyName.includes("TOSTADORES FICA") ? "EMPRESAS FICA LTDA." : rawCompanyName;
  const companyTaxId = text(company.taxId, "76.683.592-9").toUpperCase();
  const companyAddress = text(
    [company.address, company.city, company.region, company.country].filter(Boolean).join(" "),
    "SAN RAMON PS39 LTD12-18 PADRE LAS CASAS REGION DE LA ARAUCANIA, CHILE",
  ).toUpperCase();
  const companyGiro = text(company.giro, "FABRICA DE MAQUINARIA PARA FRUTOS SECOS").toUpperCase();
  const companyBank = text(company.bankName, "BANCO SCOTIABANK").toUpperCase();
  const companyAccount = text(company.bankAccount, "CUENTA CORRIENTE 979706529").toUpperCase();
  const companyEmail = text(company.email, "ADMINISTRACION@TOSTADORESFICA.CL").toUpperCase();

  const clientName = text(item.clientName).toUpperCase();
  const clientRut = text(item.clientRut).toUpperCase();
  const clientAddress = text(item.clientAddress).toUpperCase();
  const clientComuna = (comunaFrom(clientAddress) || text(item.clientComuna)).toUpperCase();
  const clientPhone = text(item.clientPhone).toUpperCase();
  const clientEmail = text(item.clientEmail).toUpperCase();
  const contact = text(item.contact ?? item.clientName).toUpperCase();
  const activity = text(item.activity ?? item.actividad).toUpperCase();
  const message = text(item.message).toUpperCase();

  const numeroOt = text(item.id).toUpperCase();
  const fechaEmision = dateSlash();
  const fechaEntrega = "POR DEFINIR";

  box(doc, 35.8, 121.1, 526.7, 19.5, BLACK);
  cellText(doc, 35.8, 121.1, 526.7, 19.5, `ORDEN DE TRABAJO N° ${numeroOt}`, {
    align: "center",
  });

  box(doc, 35.8, 149, 83.0, 14, BLACK);
  cellText(doc, 35.8, 149, 83.0, 14, "EMISIÓN");
  box(doc, 118.8, 149, 182.1, 14, GRAY_LIGHT);
  cellText(doc, 118.8, 149, 182.1, 14, fechaEmision, { color: BLACK, bold: true });
  box(doc, 300.9, 149, 67.0, 14, BLACK);
  cellText(doc, 300.9, 149, 67.0, 14, "FECHA ENTREGA");
  box(doc, 367.9, 149, 193.9, 14, GRAY_LIGHT);
  cellText(doc, 367.9, 149, 193.9, 14, fechaEntrega, { color: BLACK, bold: true });

  const clientRows: Array<[string, string, string, string]> = [
    ["NOMBRE", clientName, "RUT", clientRut],
    ["DIRECCIÓN", clientAddress, "COMUNA", clientComuna],
    ["CONTACTO", contact, "TELÉFONO", clientPhone],
    ["E-MAIL", clientEmail, "ACTIVIDAD", activity],
  ];
  let rowY = 175.5;
  for (const [labelLeft, valueLeft, labelRight, valueRight] of clientRows) {
    box(doc, 35.8, rowY, 83.0, 14, BLACK);
    cellText(doc, 35.8, rowY, 83.0, 14, labelLeft);
    box(doc, 118.8, rowY, 182.1, 14);
    cellText(doc, 118.8, rowY, 182.1, 14, valueLeft, { color: BLACK });
    box(doc, 300.9, rowY, 67.0, 14, BLACK);
    cellText(doc, 300.9, rowY, 67.0, 14, labelRight);
    box(doc, 367.9, rowY, 193.9, 14);
    cellText(doc, 367.9, rowY, 193.9, 14, valueRight, { color: BLACK });
    rowY += 16.8;
  }

  const HEADER_Y = 252.2;
  const HEADER_H = 13.3;
  const colX = [35.8, 85.4, 300.9, 367.9, 427.8, 474.6];
  const colW = [49.6, 215.5, 67.0, 59.9, 46.8, 87.2];

  box(doc, colX[0], HEADER_Y, colW[0], HEADER_H, BLACK);
  cellText(doc, colX[0], HEADER_Y, colW[0], HEADER_H, "CÓDIGO");
  box(doc, colX[1], HEADER_Y, colW[1], HEADER_H, BLACK);
  cellText(doc, colX[1], HEADER_Y, colW[1], HEADER_H, "PRODUCTO");
  box(doc, colX[2], HEADER_Y, colW[2], HEADER_H, BLACK);
  cellText(doc, colX[2], HEADER_Y, colW[2], HEADER_H, "COLOR");
  box(doc, colX[3], HEADER_Y, colW[3], HEADER_H, BLACK);
  cellText(doc, colX[3], HEADER_Y, colW[3], HEADER_H, "VALOR UNIDAD", { align: "right" });
  box(doc, colX[4], HEADER_Y, colW[4], HEADER_H, BLACK);
  cellText(doc, colX[4], HEADER_Y, colW[4], HEADER_H, "CANTIDAD", { align: "center" });
  box(doc, colX[5], HEADER_Y, colW[5], HEADER_H, BLACK);
  cellText(doc, colX[5], HEADER_Y, colW[5], HEADER_H, "TOTAL", { align: "right" });

  const maxRows = 5;
  const visibleProducts = products.slice(0, maxRows);
  const extraCount = products.length - maxRows;
  let prodY = 265.5;
  const ROW_H = 13.2;

  for (const p of visibleProducts) {
    box(doc, colX[0], prodY, colW[0], ROW_H);
    cellText(doc, colX[0], prodY, colW[0], ROW_H, p.code, { color: BLACK });
    box(doc, colX[1], prodY, colW[1], ROW_H);
    cellText(doc, colX[1], prodY, colW[1], ROW_H, p.name, { color: BLACK });
    box(doc, colX[2], prodY, colW[2], ROW_H);
    cellText(doc, colX[2], prodY, colW[2], ROW_H, p.color, { color: BLACK });
    box(doc, colX[3], prodY, colW[3], ROW_H);
    cellText(doc, colX[3], prodY, colW[3], ROW_H, moneyCLP(p.unitPrice), {
      color: BLACK,
      align: "right",
    });
    box(doc, colX[4], prodY, colW[4], ROW_H);
    cellText(doc, colX[4], prodY, colW[4], ROW_H, String(p.quantity), {
      color: BLACK,
      align: "center",
    });
    box(doc, colX[5], prodY, colW[5], ROW_H);
    cellText(doc, colX[5], prodY, colW[5], ROW_H, moneyCLP(p.quantity * p.unitPrice), {
      color: BLACK,
      align: "right",
    });
    prodY += ROW_H;
  }

  const blockY = prodY;
  const totalsRows: Array<[string, string, boolean]> = [
    ["SUBTOTAL", moneyCLP(subtotal), false],
    ["DESC.", "-", true],
    ["NETO", moneyCLP(neto), false],
    ["IVA", moneyCLP(iva), false],
    ["TOTAL", moneyCLP(total), false],
  ];
  let ty = blockY;
  for (let i = 0; i < totalsRows.length; i++) {
    const [label, value, boldValue] = totalsRows[i];
    const isLast = i === totalsRows.length - 1;
    const fill = isLast ? GRAY_VLIGHT : undefined;
    box(doc, colX[4], ty, colW[4], ROW_H, fill);
    cellText(doc, colX[4], ty, colW[4], ROW_H, label, { color: BLACK, bold: true });
    box(doc, colX[5], ty, colW[5], ROW_H, fill);
    cellText(doc, colX[5], ty, colW[5], ROW_H, value, {
      color: BLACK,
      align: "right",
      bold: boldValue,
    });
    ty += ROW_H;
  }

  const totalsBlockHeight = totalsRows.length * ROW_H;
  const obsWidth = colX[4] - 35.8 - 4;
  const noteLine = `OBSERVACIÓN: ${message || "-"}${extraCount > 0 ? ` (+${extraCount} productos más)` : ""}`;
  box(doc, 35.8, blockY, obsWidth, totalsBlockHeight, GRAY_VLIGHT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.setTextColor(...BLACK);
  const obsWrapped: string[] = doc.splitTextToSize(noteLine, obsWidth - 8);
  obsWrapped.slice(0, 4).forEach((obsSubLine, obsIdx) => {
    doc.text(obsSubLine, 40, blockY + 11 + obsIdx * 10);
  });

  const nextSectionY = blockY + totalsBlockHeight + 10;

  let gy = nextSectionY;
  box(doc, 35.8, gy, 526.7, 11.8, GRAY_MED);
  cellText(doc, 35.8, gy, 526.7, 11.8, "GESTIÓN DE ENTREGA/DESPACHO", { align: "center" });

  const gestRows: Array<[string, string, string, string]> = [
    ["FECHA", "", "DIRECCIÓN", clientAddress],
    ["FORMA DE ENTREGA", text(item.formaEntrega).toUpperCase(), "UBICACIÓN", text(item.ubicacion).toUpperCase()],
    ["CONTACTO", contact, "VALOR", "-"],
  ];
  gy += 11.8;
  for (const [labelLeft, valueLeft, labelRight, valueRight] of gestRows) {
    box(doc, 35.8, gy, 83.0, 13.3, GRAY_MED);
    cellText(doc, 35.8, gy, 83.0, 13.3, labelLeft);
    box(doc, 118.8, gy, 182.1, 13.3);
    cellText(doc, 118.8, gy, 182.1, 13.3, valueLeft, { color: BLACK });
    box(doc, 300.9, gy, 67.0, 13.3, GRAY_MED);
    cellText(doc, 300.9, gy, 67.0, 13.3, labelRight);
    box(doc, 367.9, gy, 193.9, 13.3);
    cellText(doc, 367.9, gy, 193.9, 13.3, valueRight, { color: BLACK });
    gy += 13.3;
  }

  let payY = gy + 8;
  box(doc, 35.8, payY, 526.7, 14, BLACK);
  cellText(doc, 35.8, payY, 526.7, 14, "REGISTRO DE PAGOS", { align: "center" });

  const payCols: Array<{ x: number; w: number; label: string; fill?: RGB }> = [
    { x: 35.8, w: 83.0, label: "FECHA", fill: BLACK },
    { x: 118.8, w: 182.1, label: "MONTO" },
    { x: 300.9, w: 67.0, label: "FORMA DE PAGO" },
    { x: 367.9, w: 106.7, label: "B. EMPRESA", fill: BLACK },
    { x: 474.6, w: 87.2, label: "OBSERVACIÓN", fill: BLACK },
  ];
  const payHeaderY = payY + 14;
  const payHeaderH = 13.9;
  for (const col of payCols) {
    box(doc, col.x, payHeaderY, col.w, payHeaderH, col.fill);
    cellText(doc, col.x, payHeaderY, col.w, payHeaderH, col.label, {
      color: col.fill === BLACK ? WHITE : BLACK,
      bold: true,
    });
  }

  let py = payHeaderY + payHeaderH;
  for (let i = 0; i < 2; i++) {
    for (const col of payCols) {
      box(doc, col.x, py, col.w, 13.3);
    }
    py += 13.3;
  }

  box(doc, 35.8, py, 83.0, 13.9, BLACK);
  cellText(doc, 35.8, py, 83.0, 13.9, "SALDO ABONADO");
  box(doc, 118.8, py, 182.1, 13.9);
  cellText(doc, 118.8, py, 182.1, 13.9, moneyCLP(0), { color: BLACK, align: "right" });
  box(doc, 300.9, py, 67.0, 13.9, BLACK);
  cellText(doc, 300.9, py, 67.0, 13.9, "SALDO PENDIENTE");
  box(doc, 367.9, py, 193.9, 13.9);
  cellText(doc, 367.9, py, 193.9, 13.9, moneyCLP(total), { color: BLACK, align: "right" });

  const totalRowY = py + 13.9;
  box(doc, 35.8, totalRowY, 83.0, 14, BLACK);
  cellText(doc, 35.8, totalRowY, 83.0, 14, "TOTAL");
  box(doc, 118.8, totalRowY, 182.1, 14);
  cellText(doc, 118.8, totalRowY, 182.1, 14, moneyCLP(total), {
    color: BLACK,
    align: "right",
    bold: true,
  });
  box(doc, 300.9, totalRowY, 67.0, 14, BLACK);
  cellText(doc, 300.9, totalRowY, 67.0, 14, "N° FACTURA");
  box(doc, 367.9, totalRowY, 193.9, 14);
  cellText(doc, 367.9, totalRowY, 193.9, 14, "", { color: BLACK, align: "right", bold: true });

  let eqY = totalRowY + 14 + 8;
  box(doc, 35.8, eqY, 526.7, 14, GRAY_MED);
  cellText(doc, 35.8, eqY, 526.7, 14, "REGISTRO DE EQUIPO", { align: "center" });

  const eqRows: Array<[string, string, string, string]> = [
    ["CAPACITACIÓN", text(item.capacitacion).toUpperCase(), "GARANTÍA", "1 AÑO"],
    ["N° DE SERIE EQUIPO", text(item.numeroSerie).toUpperCase(), "ACTIVIDAD", ""],
  ];
  let ey = eqY + 14;
  for (const [labelLeft, valueLeft, labelRight, valueRight] of eqRows) {
    box(doc, 35.8, ey, 83.0, 13.2, GRAY_MED);
    cellText(doc, 35.8, ey, 83.0, 13.2, labelLeft);
    box(doc, 118.8, ey, 182.1, 13.2);
    cellText(doc, 118.8, ey, 182.1, 13.2, valueLeft, { color: BLACK });
    box(doc, 300.9, ey, 67.0, 13.2, GRAY_MED);
    cellText(doc, 300.9, ey, 67.0, 13.2, labelRight);
    box(doc, 367.9, ey, 193.9, 13.2);
    cellText(doc, 367.9, ey, 193.9, 13.2, valueRight, { color: BLACK });
    ey += 13.2;
  }

  let legalY = ey + 8;
  box(doc, 35.8, legalY, 526.7, 46, GRAY_LIGHT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(...BLACK);
  const legalParagraphs = [
    "LA FÁBRICA POSEE PLAZOS DE ENTREGA DE 20-25 DÍAS QUE PUEDEN VARIAR 5 DÍAS HÁBILES, EN CONSECUENCIA DE LOS PLAZOS DE ENTREGA DE COMPONENTES ESPECIALES DE PROVEEDORES NACIONALES E INTERNACIONALES.",
    "LOS MOLINOS A MARTILLO REQUIEREN CONTAR CON UNA INSTALACIÓN ELÉCTRICA PREVIA DE 16 AMPERES, O UN AUTOMÁTICO CON GUARDAMOTOR DE 10 AMPERES EXCLUSIVO PARA EL EQUIPO.",
  ];
  let ly = legalY + 11;
  for (const paragraph of legalParagraphs) {
    const wrapped = doc.splitTextToSize(paragraph, 480) as string[];
    for (const line of wrapped) {
      if (ly > legalY + 42) break;
      doc.text(line, 299, ly, { align: "center" });
      ly += 9.2;
    }
  }

  let impBoxY = legalY + 46 + 6;
  box(doc, 35.8, impBoxY, 526.7, 24, GRAY_LIGHT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  doc.text("IMPORTANTE: ", 42, impBoxY + 12);
  const importanteText =
    "PARA HACER EFECTIVA LA GARANTÍA DE NUESTRAS MÁQUINAS, ES REQUISITO INDISPENSABLE QUE EL EQUIPO SEA TRASLADADO A NUESTRA FÁBRICA.";
  doc.setFont("helvetica", "normal");
  const importanteWrapped = doc.splitTextToSize(importanteText, 430) as string[];
  let impY = impBoxY + 12;
  for (const line of importanteWrapped) {
    doc.text(line, 42 + doc.getTextWidth("IMPORTANTE: "), impY);
    impY += 9.2;
  }

  let companyBoxY = impBoxY + 24 + 6;
  box(doc, 35.8, companyBoxY, 265.8, 66.2, GRAY_LIGHT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.setTextColor(...BLACK);
  doc.text("DATOS EMPRESA:", 42, companyBoxY + 11);

  const leftCompanyItems: Array<{ text: string; isBold?: boolean }> = [
    { text: companyName, isBold: true },
    { text: `RUT: ${companyTaxId}` },
    { text: `GIRO: ${companyGiro}` },
    { text: `CASA MATRIZ: ${companyAddress}` },
  ];

  let curYLeft = companyBoxY + 21;
  leftCompanyItems.forEach((item) => {
    doc.setFont("helvetica", item.isBold ? "bold" : "normal");
    doc.setFontSize(item.isBold ? 7.2 : 6.6);
    doc.setTextColor(...BLACK);
    const wrapped: string[] = doc.splitTextToSize(item.text, 250);
    wrapped.forEach((subLine) => {
      if (curYLeft <= companyBoxY + 62) {
        doc.text(subLine, 42, curYLeft);
        curYLeft += 9.5;
      }
    });
  });

  box(doc, 300.9, companyBoxY, 260.9, 66.2, GRAY_LIGHT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.setTextColor(...BLACK);
  doc.text("CUENTA BANCARIA:", 308, companyBoxY + 11);

  const rightCompanyItems: Array<{ text: string; isBold?: boolean }> = [
    { text: companyName, isBold: true },
    { text: `RUT: ${companyTaxId}` },
    { text: companyBank },
    { text: companyAccount },
    { text: companyEmail },
  ];

  let curYRight = companyBoxY + 21;
  rightCompanyItems.forEach((item) => {
    doc.setFont("helvetica", item.isBold ? "bold" : "normal");
    doc.setFontSize(item.isBold ? 7.2 : 6.6);
    doc.setTextColor(...BLACK);
    const wrapped: string[] = doc.splitTextToSize(item.text, 245);
    wrapped.forEach((subLine) => {
      if (curYRight <= companyBoxY + 62) {
        doc.text(subLine, 308, curYRight);
        curYRight += 9.5;
      }
    });
  });

  let bottomY = companyBoxY + 66.2 + 8;
  doc.setFont("times", "bold");
  doc.setFontSize(8.4);
  doc.setTextColor(...BLACK);
  doc.text("15 AÑOS DE EXPERIENCIA, MÁXIMA CALIDAD", 306, bottomY, { align: "center" });

  bottomY += 8;
  doc.setFont("helvetica", "bolditalic");
  doc.setFontSize(8.4);
  doc.text("Observaciones de entrega y compromisos:", 37.9, bottomY);
  bottomY += 3;
  box(doc, 36.5, bottomY, 525.3, 50);

  let firmaY = bottomY + 54;
  box(doc, 17.7, firmaY, 555.2, 40);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.6);
  doc.line(167.9, firmaY + 24, 423.2, firmaY + 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.4);
  doc.text("FIRMA CLIENTE. RECIBÍ CONFORME EL EQUIPO Y CAPACITACIÓN", 306, firmaY + 34, {
    align: "center",
  });

  box(doc, 17.7, firmaY + 42, 555.2, 12.5);

  const blob = doc.output("blob");
  const fileName = `OT-${text(item.id, "sin-numero")}.pdf`;
  const url = URL.createObjectURL(blob);

  return { blob, fileName, url, item };
}

/** Descarga un PDF de OT generado. */
export function descargarOtPdf(pdf: OtPdf): void {
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

/** Libera la URL temporal de un PDF de OT que ya no se necesita. */
export function liberarOtPdf(pdf: OtPdf): void {
  URL.revokeObjectURL(pdf.url);
}

/** Fingerprint del contenido de la OT para saber si un PDF guardado sigue vigente. */
function otFingerprint(item: SolicitudRemota): string {
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
    estado: item.estado,
    productos,
  });
}

/** Caché en memoria: reutiliza el PDF de OT si el contenido no cambió. */
const otPdfCache = new Map<string, { fingerprint: string; pdf: OtPdf }>();

/**
 * Genera (o reutiliza) el PDF de una Orden de Trabajo. Si ya existe para el
 * mismo contenido, devuelve el guardado sin regenerarlo. La caché es persistente
 * (IndexedDB): sobrevive reinicios de la app.
 */
export async function obtenerOrdenTrabajoPdf(
  item: SolicitudRemota,
): Promise<{ pdf: OtPdf; cacheado: boolean }> {
  const finger = otFingerprint(item);
  const cacheKey = `ot:${item.id}`;

  const cached = otPdfCache.get(cacheKey);
  if (cached && cached.fingerprint === finger) {
    return { pdf: cached.pdf, cacheado: true };
  }

  const persistedBlob = await readCachedPdf(cacheKey, finger);
  if (persistedBlob) {
    const pdf: OtPdf = {
      blob: persistedBlob,
      fileName: `OT-${text(item.id, "sin-numero")}.pdf`,
      url: URL.createObjectURL(persistedBlob),
      item,
    };
    otPdfCache.set(cacheKey, { fingerprint: finger, pdf });
    return { pdf, cacheado: true };
  }

  const pdf = await generarOtPdf(item);
  otPdfCache.set(cacheKey, { fingerprint: finger, pdf });
  void writeCachedPdf(cacheKey, finger, pdf.blob);
  return { pdf, cacheado: false };
}

/** Invalida el PDF de OT cacheado (tras edición). */
export function invalidarOrdenTrabajoPdf(id: string): void {
  otPdfCache.delete(`ot:${id}`);
  void deleteCachedPdf(`ot:${id}`);
}

export { generarOtPdf as generarOrdenTrabajoPdf };
