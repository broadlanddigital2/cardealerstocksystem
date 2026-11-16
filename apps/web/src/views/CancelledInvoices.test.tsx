import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import CancelledInvoices from "./CancelledInvoices";
vi.mock("@/lib/router", () => ({ Link: ({ href, children, ...rest }: { href: string; children?: unknown } & Record<string, unknown>) => <a href={href} {...rest}>{children as never}</a> }));
vi.mock("@/components/VehicleSaleHistory", () => ({ default: () => null }));

const mock = vi.hoisted(() => ({ receipt: vi.fn(), mutate: vi.fn(), invalidate: vi.fn(), csv: vi.fn(), entries: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/refundReceipt", () => ({ downloadRefundReceipt: mock.receipt }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mock.invalidate }) }));
vi.mock("@workspace/api-client-react", () => ({
  useListAccountingHistory: () => ({ data: mock.entries }),
  getListAccountingHistoryQueryKey: () => ["history"],
  useConfirmSaleRefund: () => ({ mutateAsync: mock.mutate, isPending: false }),
}));
vi.mock("@/components/SaleCancellation", () => ({ accountingError: (e: { message: string }) => e.message }));
vi.mock("@workspace/report-calc", () => ({ toCsv: mock.csv }));

describe("permanent cancelled invoice history", () => {
  beforeEach(() => {
    mock.entries = [
      { id: "credit-1", type: "credit", vehicleId: 1, creditId: 1, registration: "TEST REG", invoiceNumber: "INV-1", invoiceDate: "2025-09-15", creditNumber: "CR-2", creditDate: "2025-10-15", date: "2025-10-15", amount: -1720, net: -1600, vat: -120, reason: "Full return", actor: "Approving admin", recordedAt: "2025-10-15T12:00:00Z", refundDue: 300, refundState: "pending", recipient: "Buyer", method: "", reference: "", reconciliation: "100 deposit and 200 payment", originalDocument: '{"invoice":{"invoiceNumber":"INV-1"}}' },
      { id: "deposit-1", type: "deposit_refund", vehicleId: 2, registration: "OLD REG", invoiceNumber: "", invoiceDate: "", creditNumber: "", creditDate: "", date: "2025-08-01", amount: 50, net: 0, vat: 0, reason: "Deposit refund", actor: "Historical actor unknown", recordedAt: "2025-08-01T12:00:00Z", refundDue: 0, refundState: "fully refunded", recipient: "Old buyer", method: "Historical method unknown", reference: "", reconciliation: "Deposit only", originalDocument: "{}" },
    ];
    mock.entries[0].canRefund = true;
    mock.mutate.mockReset().mockResolvedValue({ ...mock.entries[0], id: "refund-9", type: "refund", amount: 100, date: "2025-10-16" }); mock.receipt.mockReset(); mock.invalidate.mockReset(); mock.csv.mockReset().mockReturnValue("CSV");
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("filters dates and types, exports only filtered events and never exposes edit/delete", () => {
    render(<CancelledInvoices />);
    expect(screen.getByText("OLD REG")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("From event date"), { target: { value: "2025-10-01" } });
    expect(screen.queryByText("OLD REG")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export filtered CSV" }));
    expect(mock.csv.mock.calls[0][1]).toHaveLength(1);
    expect(mock.csv.mock.calls[0][1][0]).toContain("CR-2");
    expect(screen.queryByRole("button", { name: /delete|edit history/i })).toBeNull();
    fireEvent.change(screen.getByLabelText("Event type"), { target: { value: "refund" } });
    expect(screen.getByText(/No credits, refunds or corrections match/)).toBeTruthy();
  });
  it("opens retained evidence and records an actual external refund with a stable retry key", async () => {
    render(<CancelledInvoices />);
    fireEvent.click(screen.getByRole("button", { name: "INV-1" }));
    expect(screen.getByText(/Retained original and linked credit CR-2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm external refund" }));
    fireEvent.change(screen.getByLabelText("Reason for refund (permanent)"), { target: { value: "Customer return" } });
    fireEvent.change(screen.getByLabelText("Actual amount paid (£)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Actual payment date"), { target: { value: "2025-10-16" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "Bank" } });
    fireEvent.change(screen.getByLabelText("Unique bank/payment reference"), { target: { value: "REF-123" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Record paid refund" }).closest("form")!);
    await waitFor(() => expect(mock.mutate).toHaveBeenCalledWith({ id: 1, data: {
      reason: "Customer return", amount: 100, paymentDate: "2025-10-16", recipient: "Buyer", method: "Bank", reference: "REF-123", requestKey: expect.any(String),
    } }));
    await waitFor(() => expect(mock.invalidate).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Record paid refund" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download refund receipt PDF" }));
    expect(mock.receipt).toHaveBeenCalledWith(expect.objectContaining({ id: "refund-9", amount: 100, date: "2025-10-16" }));
  });
  it("fills the full outstanding refund and lets retained refunds produce receipt copies", () => {
    mock.entries.push({ ...mock.entries[0], id: "refund-7", type: "refund", amount: 50 });
    render(<CancelledInvoices />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm external refund" }));
    fireEvent.click(screen.getByRole("button", { name: /Refund full remaining amount/ }));
    expect((screen.getByLabelText("Actual amount paid (£)") as HTMLInputElement).value).toBe("300.00");
    fireEvent.click(screen.getByRole("button", { name: "Download refund receipt" }));
    expect(mock.receipt).toHaveBeenCalledWith(expect.objectContaining({ id: "refund-7", type: "refund" }));
  });
  it("shows corrections with readable before/after evidence and no refund action", () => {
    mock.entries = [{ id: "corr-1", type: "correction", vehicleId: 3, registration: "COR REG", invoiceNumber: "INV-9", invoiceDate: "2025-09-01", creditNumber: "", creditDate: "", date: "2025-09-10", amount: 0, net: 0, vat: 0, reason: "Sale correction", actor: "Admin", recordedAt: "2025-09-10T10:00:00Z", refundDue: 0, refundState: "", recipient: "", method: "", reference: "", reconciliation: "",
      originalDocument: JSON.stringify({ beforeVehicle: { salePrice: 1000 }, afterVehicle: { salePrice: 1200 }, beforeInvoice: { buyerName: "A" }, afterInvoice: { buyerName: "B" } }) }];
    render(<CancelledInvoices />);
    fireEvent.change(screen.getByLabelText("Event type"), { target: { value: "correction" } });
    expect(screen.getByText("COR REG")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm external refund" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "INV-9" }));
    expect(screen.getByText("Sale price")).toBeTruthy();
    expect(screen.getByText("1000")).toBeTruthy();
    expect(screen.getByText("1200")).toBeTruthy();
    expect(screen.getByText("Buyer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export filtered CSV" }));
    expect(mock.csv.mock.calls[0][1][0].at(-1)).toContain("Sale price: 1000 -> 1200");
  });
});
