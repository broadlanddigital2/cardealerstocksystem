import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VehicleRefund from "./VehicleRefund";

const mocks = vi.hoisted(() => ({ save: vi.fn(), invalidate: vi.fn(), receipt: vi.fn(), credit: {} as Record<string, unknown> }));
vi.mock("@/lib/router", () => ({ Link: ({ href, children, ...rest }: { href: string; children?: unknown } & Record<string, unknown>) => <a href={href} {...rest}>{children as never}</a> }));
vi.mock("@workspace/api-client-react", () => ({
  useListAccountingHistory: () => ({ data: [mocks.credit] }),
  useConfirmSaleRefund: () => ({ mutateAsync: mocks.save, isPending: false }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock("@/lib/refundReceipt", () => ({ downloadRefundReceipt: mocks.receipt }));
beforeEach(() => {
  mocks.credit = { type: "credit", creditId: 12, creditDate: "2025-01-01", recipient: "Buyer", canRefund: true, refundDue: 250 };
  mocks.save.mockReset().mockResolvedValue({ type: "refund", id: "refund-5", amount: 250, date: "2025-01-02", returnedVehicleId: 30 });
});
afterEach(cleanup);
it("records the complete full refund on the vehicle and provides receipt and stock link", async () => {
  render(<VehicleRefund creditId={12} initialReason="Vehicle faulty" />);
  expect((screen.getByLabelText("Reason for refund") as HTMLTextAreaElement).value).toBe("Vehicle faulty");
  fireEvent.change(screen.getByLabelText("Refund date"), { target: { value: "2025-01-02" } });
  fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "Bank" } });
  fireEvent.change(screen.getByLabelText("Unique payment reference"), { target: { value: "REF-1" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(screen.getByRole("button", { name: "Confirm full refund" }).closest("form")!);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ id: 12, data: {
    amount: 250, reason: "Vehicle faulty", recipient: "Buyer", paymentDate: "2025-01-02",
    method: "Bank", reference: "REF-1", requestKey: expect.any(String),
  } }));
  await screen.findByRole("button", { name: "Download refund receipt" });
  expect(screen.getByRole("link", { name: "Open returned stock" }).getAttribute("href")).toBe("/vehicles/30");
});
it("does not record a refund without a reason", async () => {
  render(<VehicleRefund creditId={12} initialReason=" " />);
  fireEvent.submit(screen.getByRole("button", { name: "Confirm full refund" }).closest("form")!);
  expect(screen.getByRole("alert").textContent).toContain("Enter the reason");
  expect(mocks.save).not.toHaveBeenCalled();
});
it("does not offer another refund once fully refunded", () => {
  mocks.credit = { ...mocks.credit, canRefund: false, refundState: "fully refunded", refundDue: 0 };
  render(<VehicleRefund creditId={12} initialReason="" />);
  expect(screen.queryByRole("button", { name: "Confirm full refund" })).toBeNull();
  expect(screen.getByText("This sale is already fully refunded.")).toBeTruthy();
});
