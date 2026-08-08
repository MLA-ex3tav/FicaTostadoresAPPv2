import { descargarPdf, liberarPdf, type CotizacionPdf } from "../services/cotizacion-pdf";
import { renderIcon } from "./icons";
import { showToast } from "./toast";

let activeModal: HTMLElement | null = null;

function closeModal(): void {
  if (!activeModal) return;
  const url = activeModal.dataset.pdfUrl;
  activeModal.remove();
  activeModal = null;
  document.body.classList.remove("modal-open");
  if (url) {
    URL.revokeObjectURL(url);
  }
}

/** Abre el PDF en un modal dentro de la app. */
export function openPdfViewer(pdf: CotizacionPdf): void {
  closeModal();

  // Crea una URL nueva por cada apertura para poder revocarla al cerrar sin
  // afectar el PDF cacheado (que reutiliza su propia URL en memoria).
  const freshUrl = URL.createObjectURL(pdf.blob);

  const overlay = document.createElement("div");
  overlay.className = "pdf-modal";
  overlay.dataset.pdfUrl = freshUrl;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Vista previa del PDF");

  overlay.innerHTML = `
    <div class="pdf-modal__panel">
      <header class="pdf-modal__header">
        <div class="pdf-modal__header-info">
          <span class="pdf-modal__icon" aria-hidden="true">${renderIcon("fileText", { size: 20 })}</span>
          <span class="pdf-modal__title"></span>
        </div>
        <div class="pdf-modal__actions">
          <button type="button" class="btn btn--secondary btn--sm" data-pdf-download>Descargar PDF</button>
          <button type="button" class="btn btn--primary btn--sm" data-pdf-close>Cerrar</button>
        </div>
      </header>
      <iframe class="pdf-modal__frame" title="Vista previa del PDF"></iframe>
    </div>
  `;

  overlay.querySelector(".pdf-modal__title")!.textContent = pdf.fileName;
  const frame = overlay.querySelector<HTMLIFrameElement>(".pdf-modal__frame");
  if (frame) {
    frame.src = freshUrl;
  }

  overlay.querySelector("[data-pdf-close]")?.addEventListener("click", closeModal);
  overlay.querySelector("[data-pdf-download]")?.addEventListener("click", () => {
    descargarPdf(pdf);
    showToast({
      title: "PDF Descargado",
      message: `El archivo ${pdf.fileName} ha sido guardado.`,
      tone: "success",
      icon: "fileText",
    });
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", onEscape);
    }
  };
  document.addEventListener("keydown", onEscape);

  document.body.classList.add("modal-open");
  document.body.appendChild(overlay);
  activeModal = overlay;
}

export { liberarPdf };
