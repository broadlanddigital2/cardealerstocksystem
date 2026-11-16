import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SaleCancellation from "./SaleCancellation";

const mock = vi.hoisted(() => ({
  admin: true,
  state: { eligible: true, cancelled: false, gross: 1720, deposit: 100, message: "Eligible for full credit" },
  mutateAsync: vi.fn(), invalidateQueries: vi.fn(),
}));
vi.mock("@/App", () => ({ useAccess: () => ({ isAdmin: mock.admin }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mock.invalidateQueries }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetCancellationState: () => ({ data: mock.state }),
  getGetCancellationStateQueryKey: (id: number) => ["cancellation", id],
  useCancelIssuedSale: () => ({ mutateAsync: mock.mutateAsync, isPending: false }),
}));
describe("full sale cancellation controls", () => {
  beforeEach(() => {
    mock.admin = true; mock.state = { eligible: true, cancelled: false, gross: 1720, deposit: 100, message: "Eligible for full credit" };
    mock.mutateAsync.mockReset().mockResolvedValue({ cancelled: true }); mock.invalidateQueries.mockReset();
  });
  afterEach(cleanup);
  it("never offers approval to ordinary users or unverifiable legacy sales", () => {
    mock.admin = false;
    const view = render(<SaleCancellation vehicleId={7} />);
    expect(screen.queryByRole("button", { name: "Approve full cancellation" })).toBeNull();
    view.unmount(); mock.admin = true; mock.state.eligible = false; mock.state.message = "Accounting review required";
    render(<SaleCancellation vehicleId={7} />);
    expect(screen.getByText("Accounting review required")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve full cancellation" })).toBeNull();
  });
  it("submits explicit reason/date/receipts and refreshes affected views", async () => {
    render(<SaleCancellation vehicleId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve full cancellation" }));
    fireEvent.change(screen.getByLabelText("Cancellation date"), { target: { value: "2025-10-15" } });
    fireEvent.change(screen.getByLabelText("Reason (permanent)"), { target: { value: "Returned" } });
    fireEvent.change(screen.getByLabelText("Total actually received, including deposit (£)"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText(/Receipt reconciliation/), { target: { value: "100 deposit plus 200 bank, unpaid balance reconciled." } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Issue full credit" }).closest("form")!);
    await waitFor(() => expect(mock.mutateAsync).toHaveBeenCalledWith({ id: 7, data: {
      cancellationDate: "2025-10-15", reason: "Returned", receivedAmount: 300,
      reconciliation: "100 deposit plus 200 bank, unpaid balance reconciled.", receiptsConfirmed: true,
    } }));
    await waitFor(() => expect(mock.invalidateQueries).toHaveBeenCalled());
  });
  it("surfaces reconciliation conflicts without pretending approval succeeded", async () => {
    mock.mutateAsync.mockRejectedValue({ data: { error: "Receipts discrepancy" } });
    render(<SaleCancellation vehicleId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve full cancellation" }));
    fireEvent.change(screen.getByLabelText("Total actually received, including deposit (£)"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Issue full credit" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Receipts discrepancy"));
    expect(mock.invalidateQueries).not.toHaveBeenCalled();
  });
});
