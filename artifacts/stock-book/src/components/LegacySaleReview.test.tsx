import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LegacySaleReview from "./LegacySaleReview";
const mocks = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue({}), invalidate: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  getVehicle: vi.fn().mockResolvedValue({ stockNumber: "TEST", registrationNumber: "TEST", editVersion: "fresh",
    editInvoice: { invoiceNumber: "INV-TEST", extras: [] } }),
  useApproveLegacySaleReview: () => ({ mutateAsync: mocks.save, isPending: false }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
afterEach(cleanup);
it("keeps the summary without raw details and carries the required approved refund reason forward", async () => {
  const approved = vi.fn();
  const { container } = render(<LegacySaleReview vehicleId={5} onApproved={approved} />);
  await screen.findByText("INV-TEST");
  expect(container.querySelector("details")).toBeNull();
  expect(container.querySelector("pre")).toBeNull();
  expect(screen.queryByLabelText("Original document references")).toBeNull();
  expect(screen.queryByLabelText("Review notes and evidence checked")).toBeNull();
  const button = screen.getByRole("button", { name: "Approve details and continue" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Reason for refund"), { target: { value: " Vehicle faulty " } });
  expect(button.disabled).toBe(false);
  fireEvent.submit(button.closest("form")!);
  await waitFor(() => expect(approved).toHaveBeenCalledWith("Vehicle faulty"));
  expect(mocks.save).toHaveBeenCalledWith({ id: 5, data: { expectedEditVersion: "fresh", confirmed: true, refundReason: "Vehicle faulty" } });
});
