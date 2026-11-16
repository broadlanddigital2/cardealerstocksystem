# Invoice retention on vehicle deletion

Owner-approved policy: archive invoice details and reserve the number permanently.

Deleting stock copies each complete invoice record and its vehicle record into
`invoice_archive`, then removes the live invoice and vehicle in the same transaction.
Saved sale references without invoices (including mismatched historical references)
also receive an archive entry. Archive rows have no cascading vehicle foreign key.
The allocation lock serializes deletion against sale/invoice writes. An archive
failure aborts deletion; there is no fallback to unarchived deletion.

Archives are excluded from active invoice lists. Deletion is not voiding, a credit
note, or a refund, and does not undo the accounting obligations of the original sale.
There is no archive update/delete API or automatic expiry. Both new-number allocation
and explicit reference collision checks include the archive, scoped to the dealer.
Historical duplicates are preserved rather than silently merged or renumbered.

## Rollout

Apply `lib/db/migrations/20261021_invoice_archive.sql` explicitly to the intended
database before deploying the code. No startup migration or production backfill is
performed. The existing development-only post-merge schema setup can create the table.
This additive migration does not change existing records. If the table is missing,
number allocation fails and deletion of an invoiced vehicle rolls back safely.
Do not roll back to the old allocator/deletion code after archiving records: it does
not consult the archive and could reuse numbers. Retain the archive in backups.

Previously deleted invoices cannot be recovered by this change. Archive access is
currently through controlled database access, not a staff-facing archive screen.

## Issued-sale cancellation: agreed policy

This policy is implemented for sales recorded with an authoritative issuance
snapshot. Legacy sales without that snapshot are blocked for accounting review;
the app does not fabricate historical figures or currently provide a legacy
reconciliation editor. The owner confirmed the following:

- Support full sale cancellations only, not partial credits.
- Only admins may approve credits and confirm refunds made outside the app.
- Keep the original sale in its original accounting period; reverse it with a
  credit dated on cancellation.
- Provide a separate **Cancelled Invoices** report.

### Cancellation process and reference preservation

Stock deletion must never be offered as a way to cancel a sale. Keep the original
issued invoice, its number, date, amounts and customer details unchanged. Record
cancellation as a separate, permanently retained event with reason, cancellation
date, approving admin and a separately numbered full credit note.

The credit must link to the stable original invoice identity and retain its
original reference and snapshot, including when the original has been archived.
The original invoice view and cancellation report must identify the linked credit.
Neither reference may be reused. An ambiguous historical reference or incomplete
invoice must be flagged for reconciliation, not silently matched, renumbered or
credited using today's vehicle values.

Implementation must issue the credit, record approval and mark the sale cancelled
atomically. Enforce at most one full credit per issued sale, with database-backed
uniqueness and locking shared with sale/deletion operations. An identical retry
returns the existing result; a changed repeat conflicts rather than creating
another credit. A later resale is a new sale with a new invoice, not an edit of the
cancelled invoice. Per the owner's instruction, completing the full refund
automatically restores linked internal stock without a physical-return
confirmation. Neither cancellation nor refund may automatically publish it on
the showroom. Retain the original cost basis, exclude the returned record from
new-purchase totals/input VAT, and retain the required refund reason on both
vehicle records and the immutable refund event.

### Accounting reports and avoiding double-counting

Older sales without issuance snapshots may now be explicitly reviewed by an
admin through Refund vehicle. Approval requires checking all displayed saved
purchase, VAT, sale, extras and invoice figures against original documents,
entering the refund reason and ticking approval of the summary. Earlier reviews
retain their original document references and notes. A stale
record version or inconsistent invoice/vehicle values blocks approval.
The approved snapshot and review evidence are immutable, dated and attributed
to the admin, and remain in accounting history and the linked vehicle timeline
after stock deletion. Review itself does not create a credit or refund and
does not bypass unresolved finance/part-exchange checks.

Normal sales, VAT, dashboard accounting totals and accounting exports retain the
original sale on its original date and include the full reversal on the
cancellation date. A cancellation must not retrospectively remove the original
sale, rewrite its date, or alter an already reported period. Use the original
invoice's amounts and VAT treatment, not current settings or recomputed vehicle
values; reverse VAT-qualifying and margin-scheme figures consistently with their
original postings. A credit is not a reversal of the vehicle's original purchase
or all of its preparation expenses.

Use one canonical issued-sale identity across live and archived sources. Count
the original once and the credit once, even after deletion or return to stock.
Archive retention is not enough on its own: current sales reports and dashboard
queries read live vehicles, so implementation must correct that reporting gap
before cancellation is enabled. Do not sum an archived snapshot and its live copy,
or treat the separate cancellation report as another posting.

The **Cancelled Invoices** report is an audit view, filtered by cancellation date.
It should show original invoice number/date, vehicle identity, original gross/net/
VAT amounts, credit reference/date/amounts, cancellation reason, approving admin,
and refund status (including any amount still due). Preserve visibility when
stock is deleted. Provide links to the original retained invoice and the credit;
unresolved legacy data must be labelled rather than invented.

Acceptance example: a sale in September cancelled in October remains a September
sale; October contains its equal-and-opposite credit and the cancellation report
entry. A combined-period report nets the sale and credit to zero. The same result
must hold after stock deletion, a repeated request, or a subsequent resale.

### Refund responsibility

The admin is responsible for arranging refunds outside the app and confirming
what was actually paid. Issuing a credit does not transfer money and must not mark
the refund paid automatically. Retain payment records separately from credit
postings, recording recipient, amount, payment date, method/reference and recording
admin; distinguish pending, partially refunded, fully refunded and no refund due.
Prevent duplicate confirmations and over-refunds. Refund records settle the
liability; they must not reverse sales or VAT a second time.

Reconcile actual receipts, including any holding deposit already applied to the
sale, before establishing the refund due. Do not call the reserved-vehicle
deposit-refund action for an issued sale. The admin must separately reconcile
finance-company settlements, unpaid balances and any part-exchange return or
agreed cash settlement; do not assume all credited money belongs to the buyer.
Block automatic completion where that reconciliation is unresolved. This policy
does not change the existing reserved-deposit concurrency workflow.

### Implementation boundary

New issuance snapshots, full credits and external refund confirmations are retained
in separate append-only application tables, without cascading stock foreign keys.
No application API edits or deletes that history, including for admins. Direct
database-owner access is outside these application guarantees.

Admins can approve eligible full cancellations from sold-vehicle details and
confirm actual external refund payments in the separate Cancelled Invoices report.
Finance/PX cancellations remain blocked pending reconciliation; cancellation does
not return stock automatically. After physical return, use a new stock identity.
The report includes historical deposit refunds with explicitly unknown actors
where the original record did not capture one.

Sales reports, dashboard VAT and journal data retain original postings and dated
credits, deduplicating live/retained originals. Credit export rows reverse sales
and output VAT, not purchase/stock movements. Journal CSV has invoice-format
columns: credit rows require accountant review and the destination system's
credit-note workflow, not automatic sales-invoice import.

The additive development schema is applied with the normal Drizzle push flow.
No startup migration, production mutation or historical backfill is performed.
Historical reference auditing and general retrieval of deleted-vehicle invoices
remain separate workstreams. Accountant review of statutory VAT/export presentation
is still advisable; owner approval here is a product decision, not tax advice.

### Audited sales and purchase corrections

Edit Vehicle and Edit Sale remain available for non-cancelled sales. Corrections
update the current vehicle/invoice and current reports, while append-only
`vehicle_revisions` retain the before/after vehicle and invoice, actor and time.
The first issuance snapshot is never overwritten. Latest retained corrections
drive current accounting even after stock deletion; they are not extra postings.
The separate history report exposes these as Corrections with readable changes.

Cancellation freezes the effective accounting snapshot approved for that credit,
so later metadata corrections cannot change the credit or refund liability.
Financial/receipt edits after cancellation remain blocked. Correcting a legacy
sale does not certify its missing original issuance basis or unlock cancellation.
Corrections can restate current reports for earlier dates; there is no submitted
VAT-period lock in this workflow.
