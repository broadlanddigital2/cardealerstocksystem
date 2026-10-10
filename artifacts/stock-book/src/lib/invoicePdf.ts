import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency, formatDate } from "./format";
import {
  computeExtrasInvoiceTotals,
  computeHoldingDepositBalance,
  computeMarginInvoiceTotals,
  computeVatInvoiceTotals,
  extraGross,
} from "./invoiceMath";

export interface InvoicePdfVehicle {
  stockNumber?: string | null;
  make: string;
  model: string;
  registrationNumber: string;
  vin?: string | null;
  colour?: string | null;
  description?: string | null;
  mileageAtPurchase?: number | null;
  partExchangeMake?: string | null;
  partExchangeModel?: string | null;
  partExchangeRegistration?: string | null;
  partExchangeMileage?: number | null;
}

export interface InvoicePdfInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerAddress: string;
  salePrice: number;
  saleVat?: number | null;
  partExchangeAllowance?: number | null;
  holdingDeposit?: number | null;
  financeCompanyName?: string | null;
  financeCompanyAddress?: string | null;
  financeCompanyEmail?: string | null;
  // Free-text note entered at sale time; rendered after the vehicle-details table.
  invoiceNotes?: string | null;
  // Extras to bill on this invoice itself (finance sales where the dealer chose
  // to include extras on the finance invoice rather than a separate one).
  extras?: InvoiceExtra[];
}

export interface InvoiceExtra {
  description: string;
  amount: number;
  vat?: number;
}

export interface ExtrasInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerAddress: string;
  extras: InvoiceExtra[];
}

export interface InvoicePdfSettings {
  businessName: string;
  address?: string | null;
  vatNumber?: string | null;
  businessType?: string | null;
  companyName?: string | null;
  companyNumber?: string | null;
  placeOfRegistration?: string | null;
  registeredOfficeAddress?: string | null;
  bankAccountName?: string | null;
  bankName?: string | null;
  bankSortCode?: string | null;
  bankAccountNumber?: string | null;
  marginSchemeWording?: string | null;
  defaultInvoiceWording?: string | null;
  logoPath?: string | null;
}

interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

function loadImageData(url: string): Promise<LoadedImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve({
          dataUrl: canvas.toDataURL("image/png"),
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const LOGO_TOP_Y = 6;
const LOGO_MAX_W = 110;
const LOGO_MAX_H = 48;

// Vertical band reserved at the bottom of every page for the statutory company
// footer, so body tables and text blocks never overlap it (drawCompanyFooter
// renders within this band).
const FOOTER_RESERVE = 28;

/**
 * Places the dealer logo in the top-right corner of the page, aligning its right
 * edge with the right edge of the body tables, and returns the Y baseline
 * immediately below it so callers can position the rest of the header content.
 * jspdf-autotable's default horizontal margin is `40 / scaleFactor`, so the table
 * right edge sits at `pageWidth - 40 / scaleFactor`; the logo matches it.
 */
function placeHeaderLogo(doc: jsPDF, logo: LoadedImage | null): number {
  if (!logo) return 22;
  const ratio = Math.min(LOGO_MAX_W / logo.width, LOGO_MAX_H / logo.height);
  const w = logo.width * ratio;
  const h = logo.height * ratio;
  const margin = 40 / doc.internal.scaleFactor;
  const tableRightEdge = doc.internal.pageSize.getWidth() - margin;
  // Nudge the logo toward the page's right edge (half the table margin) so it
  // sits further right than the body tables while staying on the page.
  const rightNudge = margin / 2;
  doc.addImage(logo.dataUrl, "PNG", tableRightEdge - w + rightNudge, LOGO_TOP_Y, w, h);
  return LOGO_TOP_Y + h + 6;
}

/**
 * Formats the dealer address across (up to) two lines: address parts are split
 * on newlines/commas and balanced between a first and second line.
 */
function formatAddressTwoLines(address?: string | null): string[] {
  if (!address) return [];
  const parts = address
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length <= 1) return parts;
  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid).join(", "), parts.slice(mid).join(", ")];
}

/**
 * Draws the statutory company footer at the bottom of the current (last) page.
 * For a Limited Company this shows the company name, place of registration,
 * company number, registered office address (only when it differs from the
 * trading address) and VAT number. For any other business type, only the VAT
 * number is shown.
 */
function drawCompanyFooter(doc: jsPDF, settings: InvoicePdfSettings): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const lineHeight = 4;

  const trimmed = (v?: string | null): string => (v ?? "").trim();
  const normalise = (v?: string | null): string =>
    trimmed(v).replace(/\s+/g, " ").toLowerCase();

  const segments: string[] = [];
  if (settings.businessType === "Limited Company") {
    const name = trimmed(settings.companyName) || trimmed(settings.businessName);
    const place = trimmed(settings.placeOfRegistration);
    if (name) {
      segments.push(place ? `${name} is registered in ${place}` : name);
    } else if (place) {
      segments.push(`Registered in ${place}`);
    }
    if (trimmed(settings.companyNumber)) {
      segments.push(`Company No: ${trimmed(settings.companyNumber)}`);
    }
    const regOffice = trimmed(settings.registeredOfficeAddress);
    if (regOffice && normalise(regOffice) !== normalise(settings.address)) {
      segments.push(`Registered Office: ${regOffice.replace(/\n/g, ", ")}`);
    }
  }
  if (trimmed(settings.vatNumber)) {
    segments.push(`VAT Reg No: ${trimmed(settings.vatNumber)}`);
  }

  if (segments.length === 0) return;

  doc.setFontSize(8);
  doc.setTextColor(110);
  const lines = doc.splitTextToSize(
    segments.join("   •   "),
    contentWidth,
  ) as string[];
  const firstLineY = pageHeight - 8 - (lines.length - 1) * lineHeight;
  doc.setDrawColor(210);
  doc.line(marginX, firstLineY - lineHeight - 2, pageWidth - marginX, firstLineY - lineHeight - 2);
  doc.text(lines, pageWidth / 2, firstLineY, { align: "center" });
  doc.setTextColor(0);
}

export async function generateInvoicePdf(
  invoice: InvoicePdfInvoice,
  vehicle: InvoicePdfVehicle,
  settings: InvoicePdfSettings,
): Promise<void> {
  const doc = new jsPDF();

  // Left column: invoice meta
  doc.setFontSize(16);
  doc.text("SALES INVOICE", 14, 22);
  doc.setFontSize(12);
  doc.text(settings.businessName || "", 14, 29);
  doc.setFontSize(10);
  let leftBottom = 35;
  const addressLines = formatAddressTwoLines(settings.address);
  if (addressLines.length > 0) {
    doc.text(addressLines, 14, leftBottom);
    leftBottom += addressLines.length * 5 + 3;
  }
  doc.text(`Invoice No: ${invoice.invoiceNumber}`, 14, leftBottom);
  if (settings.vatNumber) {
    leftBottom += 6;
    doc.text(`VAT Reg No: ${settings.vatNumber}`, 14, leftBottom);
  }
  leftBottom += 6;
  doc.text(`Date: ${formatDate(invoice.invoiceDate)}`, 14, leftBottom);

  // Right column: logo only (company name + address now appear in the footer)
  const logo = settings.logoPath
    ? await loadImageData(`/api/storage${settings.logoPath}`)
    : null;
  const rightY = placeHeaderLogo(doc, logo);

  doc.setFontSize(10);

  const custY = Math.max(leftBottom, rightY) + 10;
  const hasFinanceCompany = !!(
    invoice.financeCompanyName ||
    invoice.financeCompanyAddress ||
    invoice.financeCompanyEmail
  );

  doc.text("Customer:", 14, custY);
  const customerLines: string[] = [];
  if (hasFinanceCompany) {
    if (invoice.financeCompanyName) customerLines.push(invoice.financeCompanyName);
    if (invoice.financeCompanyAddress) {
      customerLines.push(...invoice.financeCompanyAddress.split("\n"));
    }
    if (invoice.financeCompanyEmail) {
      customerLines.push(`Email: ${invoice.financeCompanyEmail}`);
    }
  } else {
    if (invoice.customerName) customerLines.push(invoice.customerName);
    if (invoice.customerAddress) {
      customerLines.push(...invoice.customerAddress.split("\n"));
    }
  }
  doc.text(customerLines, 14, custY + 5);

  let blocksBottomY = custY + 5 + customerLines.length * 5;
  if (hasFinanceCompany) {
    const deliveredX = 150;
    doc.text("Delivered To:", deliveredX, custY);
    const deliveredLines: string[] = [];
    if (invoice.customerName) deliveredLines.push(invoice.customerName);
    if (invoice.customerAddress) {
      deliveredLines.push(...invoice.customerAddress.split("\n"));
    }
    doc.text(deliveredLines, deliveredX, custY + 5);
    const deliveredBottomY = custY + 5 + deliveredLines.length * 5;
    blocksBottomY = Math.max(blocksBottomY, deliveredBottomY);
  }

  const pxAllowance = invoice.partExchangeAllowance ?? 0;
  const holdingDeposit = invoice.holdingDeposit ?? 0;
  // Extras are normally billed on a separate VAT invoice. When the dealer chose
  // to include them on this (finance) invoice they appear as line items below
  // and are added to the balance payable.
  const extras = invoice.extras ?? [];
  const { balancePayable } = computeMarginInvoiceTotals({
    salePrice: invoice.salePrice,
    partExchangeAllowance: pxAllowance,
    holdingDeposit,
    extras,
  });

  const pxLines: string[] = [];
  const pxRegLine = [
    ...(vehicle.partExchangeRegistration
      ? [`Reg: ${vehicle.partExchangeRegistration}`]
      : []),
    ...(vehicle.partExchangeMileage != null
      ? [`Mileage: ${vehicle.partExchangeMileage.toLocaleString("en-GB")}`]
      : []),
  ].join(" ");
  if (pxRegLine) pxLines.push(pxRegLine);
  const pxDetailLine = [
    ...(vehicle.partExchangeMake ? [vehicle.partExchangeMake] : []),
    ...(vehicle.partExchangeModel ? [vehicle.partExchangeModel] : []),
  ].join(" ");
  if (pxDetailLine) pxLines.push(`Vehicle Details: ${pxDetailLine}`);

  autoTable(doc, {
    startY: blocksBottomY + 6,
    head: [["Vehicle Details", "Amount"]],
    bodyStyles: { textColor: [0, 0, 0] },
    body: [
      [
        [
          ...(vehicle.stockNumber ? [`Stock No: ${vehicle.stockNumber}`] : []),
          [
            `Reg: ${vehicle.registrationNumber}`,
            ...(vehicle.mileageAtPurchase != null
              ? [`Mileage: ${vehicle.mileageAtPurchase.toLocaleString("en-GB")}`]
              : []),
            ...(vehicle.vin ? [`VIN: ${vehicle.vin}`] : []),
          ].join(" "),
          `Vehicle Details: ${[
            vehicle.make,
            vehicle.model,
            ...(vehicle.description ? [vehicle.description] : []),
            ...(vehicle.colour ? [vehicle.colour] : []),
          ].join(" ")}`,
        ].join("\n"),
        formatCurrency(invoice.salePrice),
      ],
      ...(invoice.invoiceNotes && invoice.invoiceNotes.trim()
        ? [
            [
              {
                content: invoice.invoiceNotes.trim(),
                colSpan: 2,
                styles: { textColor: [0, 0, 0] as [number, number, number] },
              },
            ],
          ]
        : []),
      ...(pxAllowance
        ? [
            [
              {
                content: "Part Exchange Allowance",
                colSpan: 2,
                styles: {
                  fillColor: [30, 41, 59] as [number, number, number],
                  textColor: 255,
                  fontStyle: "bold" as const,
                },
              },
            ],
            [pxLines.join("\n"), `-${formatCurrency(pxAllowance)}`],
          ]
        : []),
      ...extras.map((e) => {
        const vat = e.vat ?? 0;
        return [
          vat > 0 ? `${e.description} (inc. VAT ${formatCurrency(vat)})` : e.description,
          formatCurrency(extraGross(e)),
        ];
      }),
      ...(holdingDeposit
        ? [["Less Deposit Paid", `-${formatCurrency(holdingDeposit)}`]]
        : []),
      ...(pxAllowance || holdingDeposit || extras.length
        ? [
            [
              {
                content: "Balance Payable",
                styles: { fontStyle: "bold" as const },
              },
              {
                content: formatCurrency(balancePayable),
                styles: { fontStyle: "bold" as const },
              },
            ],
          ]
        : []),
    ],
    theme: "grid",
    margin: { bottom: FOOTER_RESERVE },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index === 1) {
        data.cell.styles.halign = "right";
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY || 120;

  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const bottomMargin = FOOTER_RESERVE;
  const lineHeight = 5;

  let afterTableY = finalY + 14;

  // Draw text wrapped to the content width, adding a page break when the block
  // would overflow the bottom of the page.
  const drawBlock = (text: string, fontSize: number): void => {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    const blockHeight = lines.length * lineHeight;
    if (afterTableY + blockHeight > pageHeight - bottomMargin) {
      doc.addPage();
      afterTableY = 20;
    }
    doc.text(lines, marginX, afterTableY);
    afterTableY += blockHeight;
  };

  const bankLines: string[] = [];
  if (settings.bankAccountName) bankLines.push(`Account Name: ${settings.bankAccountName}`);
  if (settings.bankName) bankLines.push(`Bank: ${settings.bankName}`);
  if (settings.bankSortCode) bankLines.push(`Sort Code: ${settings.bankSortCode}`);
  if (settings.bankAccountNumber) bankLines.push(`Account Number: ${settings.bankAccountNumber}`);

  if (bankLines.length > 0) {
    drawBlock("Bank Details", 11);
    afterTableY += 1;
    drawBlock(bankLines.join("\n"), 10);
    afterTableY += 8;
  }

  if (settings.marginSchemeWording) {
    drawBlock(settings.marginSchemeWording, 10);
  }
  if (settings.defaultInvoiceWording) {
    drawBlock(settings.defaultInvoiceWording, 10);
  }

  drawCompanyFooter(doc, settings);
  doc.save(`Invoice_${invoice.invoiceNumber}.pdf`);
}

/**
 * Standard VAT sales invoice for a VAT-qualifying vehicle. Unlike the
 * margin-scheme invoice, the sale price is net and VAT is shown as a separate
 * line. The margin-scheme wording must NOT appear here.
 */
export async function generateVatVehicleInvoicePdf(
  invoice: InvoicePdfInvoice,
  vehicle: InvoicePdfVehicle,
  settings: InvoicePdfSettings,
): Promise<void> {
  const doc = new jsPDF();

  // Left column: invoice meta
  doc.setFontSize(16);
  doc.text("VAT INVOICE", 14, 22);
  doc.setFontSize(12);
  doc.text(settings.businessName || "", 14, 29);
  doc.setFontSize(10);
  let leftBottom = 35;
  const addressLines = formatAddressTwoLines(settings.address);
  if (addressLines.length > 0) {
    doc.text(addressLines, 14, leftBottom);
    leftBottom += addressLines.length * 5 + 3;
  }
  doc.text(`Invoice No: ${invoice.invoiceNumber}`, 14, leftBottom);
  if (settings.vatNumber) {
    leftBottom += 6;
    doc.text(`VAT Reg No: ${settings.vatNumber}`, 14, leftBottom);
  }
  leftBottom += 6;
  doc.text(`Date: ${formatDate(invoice.invoiceDate)}`, 14, leftBottom);

  // Right column: logo only (company name + address now appear in the footer)
  const logo = settings.logoPath
    ? await loadImageData(`/api/storage${settings.logoPath}`)
    : null;
  const rightY = placeHeaderLogo(doc, logo);

  doc.setFontSize(10);

  const custY = Math.max(leftBottom, rightY) + 10;
  const hasFinanceCompany = !!(
    invoice.financeCompanyName ||
    invoice.financeCompanyAddress ||
    invoice.financeCompanyEmail
  );

  doc.text("Customer:", 14, custY);
  const customerLines: string[] = [];
  if (hasFinanceCompany) {
    if (invoice.financeCompanyName) customerLines.push(invoice.financeCompanyName);
    if (invoice.financeCompanyAddress) {
      customerLines.push(...invoice.financeCompanyAddress.split("\n"));
    }
    if (invoice.financeCompanyEmail) {
      customerLines.push(`Email: ${invoice.financeCompanyEmail}`);
    }
  } else {
    if (invoice.customerName) customerLines.push(invoice.customerName);
    if (invoice.customerAddress) {
      customerLines.push(...invoice.customerAddress.split("\n"));
    }
  }
  doc.text(customerLines, 14, custY + 5);

  let blocksBottomY = custY + 5 + customerLines.length * 5;
  if (hasFinanceCompany) {
    const deliveredX = 150;
    doc.text("Delivered To:", deliveredX, custY);
    const deliveredLines: string[] = [];
    if (invoice.customerName) deliveredLines.push(invoice.customerName);
    if (invoice.customerAddress) {
      deliveredLines.push(...invoice.customerAddress.split("\n"));
    }
    doc.text(deliveredLines, deliveredX, custY + 5);
    const deliveredBottomY = custY + 5 + deliveredLines.length * 5;
    blocksBottomY = Math.max(blocksBottomY, deliveredBottomY);
  }

  // Extras are normally billed on a separate VAT invoice. When the dealer chose
  // to include them on this (finance) invoice they fold into the net subtotal,
  // VAT and total below.
  const extras = invoice.extras ?? [];
  const pxAllowance = invoice.partExchangeAllowance ?? 0;
  const holdingDeposit = invoice.holdingDeposit ?? 0;
  const { subtotalNet, vatTotal, grossTotal, balancePayable } =
    computeVatInvoiceTotals({
      salePrice: invoice.salePrice,
      saleVat: invoice.saleVat,
      partExchangeAllowance: pxAllowance,
      holdingDeposit,
      extras,
    });

  const pxLines: string[] = [];
  const pxRegLine = [
    ...(vehicle.partExchangeRegistration
      ? [`Reg: ${vehicle.partExchangeRegistration}`]
      : []),
    ...(vehicle.partExchangeMileage != null
      ? [`Mileage: ${vehicle.partExchangeMileage.toLocaleString("en-GB")}`]
      : []),
  ].join(" ");
  if (pxRegLine) pxLines.push(pxRegLine);
  const pxDetailLine = [
    ...(vehicle.partExchangeMake ? [vehicle.partExchangeMake] : []),
    ...(vehicle.partExchangeModel ? [vehicle.partExchangeModel] : []),
  ].join(" ");
  if (pxDetailLine) pxLines.push(`Vehicle Details: ${pxDetailLine}`);

  const boldRight = { halign: "right" as const, fontStyle: "bold" as const };

  autoTable(doc, {
    startY: blocksBottomY + 6,
    head: [["Vehicle Details", "Amount"]],
    bodyStyles: { textColor: [0, 0, 0] },
    body: [
      [
        [
          ...(vehicle.stockNumber ? [`Stock No: ${vehicle.stockNumber}`] : []),
          [
            `Reg: ${vehicle.registrationNumber}`,
            ...(vehicle.mileageAtPurchase != null
              ? [`Mileage: ${vehicle.mileageAtPurchase.toLocaleString("en-GB")}`]
              : []),
            ...(vehicle.vin ? [`VIN: ${vehicle.vin}`] : []),
          ].join(" "),
          `Vehicle Details: ${[
            vehicle.make,
            vehicle.model,
            ...(vehicle.description ? [vehicle.description] : []),
            ...(vehicle.colour ? [vehicle.colour] : []),
          ].join(" ")}`,
        ].join("\n"),
        formatCurrency(invoice.salePrice),
      ],
      ...(invoice.invoiceNotes && invoice.invoiceNotes.trim()
        ? [
            [
              {
                content: invoice.invoiceNotes.trim(),
                colSpan: 2,
                styles: { textColor: [0, 0, 0] as [number, number, number] },
              },
            ],
          ]
        : []),
      ...extras.map((e) => [e.description, formatCurrency(e.amount)]),
      [
        { content: "Subtotal (Net)", styles: { halign: "right" as const } },
        { content: formatCurrency(subtotalNet), styles: { halign: "right" as const } },
      ],
      [
        { content: "VAT", styles: { halign: "right" as const } },
        { content: formatCurrency(vatTotal), styles: { halign: "right" as const } },
      ],
      [
        { content: "Total (inc. VAT)", styles: boldRight },
        { content: formatCurrency(grossTotal), styles: boldRight },
      ],
      ...(pxAllowance
        ? [
            [
              {
                content: "Part Exchange Allowance",
                colSpan: 2,
                styles: {
                  fillColor: [30, 41, 59] as [number, number, number],
                  textColor: 255,
                  fontStyle: "bold" as const,
                },
              },
            ],
            [pxLines.join("\n"), `-${formatCurrency(pxAllowance)}`],
          ]
        : []),
      ...(holdingDeposit
        ? [["Less Deposit Paid", `-${formatCurrency(holdingDeposit)}`]]
        : []),
      ...(pxAllowance || holdingDeposit
        ? [
            [
              { content: "Balance Payable", styles: boldRight },
              { content: formatCurrency(balancePayable), styles: boldRight },
            ],
          ]
        : []),
    ],
    theme: "grid",
    margin: { bottom: FOOTER_RESERVE },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index === 1) {
        data.cell.styles.halign = "right";
      }
    },
  });

  const finalY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY || 120;

  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const bottomMargin = FOOTER_RESERVE;
  const lineHeight = 5;

  let afterTableY = finalY + 14;

  const drawBlock = (text: string, fontSize: number): void => {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    const blockHeight = lines.length * lineHeight;
    if (afterTableY + blockHeight > pageHeight - bottomMargin) {
      doc.addPage();
      afterTableY = 20;
    }
    doc.text(lines, marginX, afterTableY);
    afterTableY += blockHeight;
  };

  const bankLines: string[] = [];
  if (settings.bankAccountName) bankLines.push(`Account Name: ${settings.bankAccountName}`);
  if (settings.bankName) bankLines.push(`Bank: ${settings.bankName}`);
  if (settings.bankSortCode) bankLines.push(`Sort Code: ${settings.bankSortCode}`);
  if (settings.bankAccountNumber) bankLines.push(`Account Number: ${settings.bankAccountNumber}`);

  if (bankLines.length > 0) {
    drawBlock("Bank Details", 11);
    afterTableY += 1;
    drawBlock(bankLines.join("\n"), 10);
    afterTableY += 8;
  }

  // Additional invoice footer wording appears on every invoice. The
  // margin-scheme statement is deliberately NOT shown on this standard VAT invoice.
  if (settings.defaultInvoiceWording) {
    drawBlock(settings.defaultInvoiceWording, 10);
  }

  drawCompanyFooter(doc, settings);
  doc.save(`Invoice_${invoice.invoiceNumber}.pdf`);
}

/**
 * Standard VAT invoice for the optional sale extras (warranty, delivery, etc.).
 * These are billed separately from the margin-scheme car sales invoice and the
 * invoice number is the car invoice number with a letter suffix (e.g. INV-0005A).
 */
export async function generateExtrasInvoicePdf(
  invoice: ExtrasInvoice,
  vehicle: InvoicePdfVehicle,
  settings: InvoicePdfSettings,
): Promise<void> {
  const doc = new jsPDF();

  // Left column: invoice meta
  doc.setFontSize(16);
  doc.text("VAT INVOICE", 14, 22);
  doc.setFontSize(12);
  doc.text(settings.businessName || "", 14, 29);
  doc.setFontSize(10);
  let leftBottom = 35;
  const addressLines = formatAddressTwoLines(settings.address);
  if (addressLines.length > 0) {
    doc.text(addressLines, 14, leftBottom);
    leftBottom += addressLines.length * 5 + 3;
  }
  doc.text(`Invoice No: ${invoice.invoiceNumber}`, 14, leftBottom);
  if (settings.vatNumber) {
    leftBottom += 6;
    doc.text(`VAT Reg No: ${settings.vatNumber}`, 14, leftBottom);
  }
  leftBottom += 6;
  doc.text(`Date: ${formatDate(invoice.invoiceDate)}`, 14, leftBottom);

  // Right column: logo only (company name + address now appear in the footer)
  const logo = settings.logoPath
    ? await loadImageData(`/api/storage${settings.logoPath}`)
    : null;
  const rightY = placeHeaderLogo(doc, logo);

  doc.setFontSize(10);

  const custY = Math.max(leftBottom, rightY) + 10;
  doc.text("Customer:", 14, custY);
  const customerLines: string[] = [];
  if (invoice.customerName) customerLines.push(invoice.customerName);
  if (invoice.customerAddress) {
    customerLines.push(...invoice.customerAddress.split("\n"));
  }
  doc.text(customerLines, 14, custY + 5);

  // Reference back to the vehicle the extras relate to.
  const reY = custY + 5 + customerLines.length * 5 + 6;
  doc.text(
    `Re: ${vehicle.make} ${vehicle.model} (${vehicle.registrationNumber})`,
    14,
    reY,
  );

  const { netTotal, vatTotal, grossTotal } = computeExtrasInvoiceTotals(
    invoice.extras,
  );

  autoTable(doc, {
    startY: reY + 6,
    head: [["Description", "Net", "VAT", "Total"]],
    body: [
      ...invoice.extras.map((e) => {
        const vat = e.vat ?? 0;
        return [
          e.description,
          formatCurrency(e.amount),
          formatCurrency(vat),
          formatCurrency(extraGross(e)),
        ];
      }),
      [
        { content: "Subtotal (Net)", colSpan: 3, styles: { halign: "right" as const } },
        { content: formatCurrency(netTotal), styles: { halign: "right" as const } },
      ],
      [
        { content: "VAT", colSpan: 3, styles: { halign: "right" as const } },
        { content: formatCurrency(vatTotal), styles: { halign: "right" as const } },
      ],
      [
        {
          content: "Total",
          colSpan: 3,
          styles: { halign: "right" as const, fontStyle: "bold" as const },
        },
        {
          content: formatCurrency(grossTotal),
          styles: { halign: "right" as const, fontStyle: "bold" as const },
        },
      ],
    ],
    theme: "grid",
    margin: { bottom: FOOTER_RESERVE },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index > 0) {
        data.cell.styles.halign = "right";
      }
    },
  });

  const finalY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY || 120;

  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const bottomMargin = FOOTER_RESERVE;
  const lineHeight = 5;

  let afterTableY = finalY + 14;

  const drawBlock = (text: string, fontSize: number): void => {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    const blockHeight = lines.length * lineHeight;
    if (afterTableY + blockHeight > pageHeight - bottomMargin) {
      doc.addPage();
      afterTableY = 20;
    }
    doc.text(lines, marginX, afterTableY);
    afterTableY += blockHeight;
  };

  const bankLines: string[] = [];
  if (settings.bankAccountName) bankLines.push(`Account Name: ${settings.bankAccountName}`);
  if (settings.bankName) bankLines.push(`Bank: ${settings.bankName}`);
  if (settings.bankSortCode) bankLines.push(`Sort Code: ${settings.bankSortCode}`);
  if (settings.bankAccountNumber) bankLines.push(`Account Number: ${settings.bankAccountNumber}`);

  if (bankLines.length > 0) {
    drawBlock("Bank Details", 11);
    afterTableY += 1;
    drawBlock(bankLines.join("\n"), 10);
    afterTableY += 8;
  }

  // Additional invoice footer wording appears on every invoice. The
  // margin-scheme statement is deliberately NOT shown on this VAT extras invoice.
  if (settings.defaultInvoiceWording) {
    drawBlock(settings.defaultInvoiceWording, 10);
  }

  drawCompanyFooter(doc, settings);
  doc.save(`Invoice_${invoice.invoiceNumber}.pdf`);
}

export interface HoldingDepositReceipt {
  reference: string;
  date: string;
  amount: number;
  customerName: string;
  customerAddress: string;
  salePrice?: number | null;
}

export async function generateHoldingDepositPdf(
  receipt: HoldingDepositReceipt,
  vehicle: InvoicePdfVehicle,
  settings: InvoicePdfSettings,
): Promise<void> {
  const doc = new jsPDF();

  // Left column: receipt meta
  doc.setFontSize(16);
  doc.text("HOLDING DEPOSIT RECEIPT", 14, 22);
  doc.setFontSize(12);
  doc.text(settings.businessName || "", 14, 29);
  doc.setFontSize(10);
  let leftBottom = 35;
  const addressLines = formatAddressTwoLines(settings.address);
  if (addressLines.length > 0) {
    doc.text(addressLines, 14, leftBottom);
    leftBottom += addressLines.length * 5 + 3;
  }
  doc.text(`Reference: ${receipt.reference}`, 14, leftBottom);
  leftBottom += 6;
  doc.text(`Date: ${formatDate(receipt.date)}`, 14, leftBottom);

  // Right column: logo only (company name + address now appear in the footer)
  const logo = settings.logoPath
    ? await loadImageData(`/api/storage${settings.logoPath}`)
    : null;
  const rightY = placeHeaderLogo(doc, logo);

  doc.setFontSize(10);

  const custY = Math.max(leftBottom, rightY) + 10;
  doc.text("Received From:", 14, custY);
  const customerLines: string[] = [];
  if (receipt.customerName) customerLines.push(receipt.customerName);
  if (receipt.customerAddress) {
    customerLines.push(...receipt.customerAddress.split("\n"));
  }
  doc.text(customerLines, 14, custY + 5);

  const salePrice = receipt.salePrice ?? null;

  autoTable(doc, {
    startY: custY + 5 + customerLines.length * 5 + 6,
    head: [["Vehicle Reserved", "Amount"]],
    body: [
      [
        [
          ...(vehicle.stockNumber ? [`Stock No: ${vehicle.stockNumber}`] : []),
          `Make: ${vehicle.make}`,
          `Model: ${vehicle.model}`,
          `Reg: ${vehicle.registrationNumber}`,
          ...(vehicle.mileageAtPurchase != null
            ? [`Mileage: ${vehicle.mileageAtPurchase.toLocaleString("en-GB")}`]
            : []),
        ].join("\n"),
        "",
      ],
      [
        { content: "Holding Deposit Received", styles: { fontStyle: "bold" as const } },
        { content: formatCurrency(receipt.amount), styles: { fontStyle: "bold" as const } },
      ],
      ...(salePrice != null
        ? [
            ["Agreed Sale Price", formatCurrency(salePrice)],
            [
              {
                content: "Balance Due on Collection",
                styles: { fontStyle: "bold" as const },
              },
              {
                content: formatCurrency(
                  computeHoldingDepositBalance(salePrice, receipt.amount),
                ),
                styles: { fontStyle: "bold" as const },
              },
            ],
          ]
        : []),
    ],
    theme: "grid",
    margin: { bottom: FOOTER_RESERVE },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index === 1) {
        data.cell.styles.halign = "right";
      }
    },
  });

  const finalY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY || 120;

  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - 14 * 2;

  doc.setFontSize(10);
  const noteLines = doc.splitTextToSize(
    "This deposit reserves the above vehicle and will be deducted from the final sale price.",
    contentWidth,
  ) as string[];
  let noteY = finalY + 14;
  if (noteY + noteLines.length * 5 > pageHeight - FOOTER_RESERVE) {
    doc.addPage();
    noteY = 20;
  }
  doc.text(noteLines, 14, noteY);

  drawCompanyFooter(doc, settings);
  doc.save(`Holding_Deposit_${receipt.reference}.pdf`);
}
