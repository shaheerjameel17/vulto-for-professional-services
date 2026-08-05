---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Financial
aliases:
  - VRS-F066
---

# VRS-F066 — Disbursement and Payment Adapter

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (PaySlip, the primary payment instruction source), [[VRS-F064_Multi-Currency_Payroll|VRS-F064]] (disbursement currency and amount), [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] (**approval, without which nothing disburses**), [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] (contractor invoices, the second source), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (the provider abstraction every external service is reached through), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (DisbursementBatch and DisbursementInstruction)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Why this feature exists

The previous specification set routed every payment through [[Vulto Pay]] — a payment service planned years out and not yet built.

**A payroll engine that can only pay through infrastructure that does not exist cannot pay anyone.** That dependency is removed entirely, per founder decision, and replaced by what an agency actually uses today.

The result is better architecture regardless of Vulto Pay's timeline. Every provider — a bank, Wise, a local rail, Vulto Pay eventually — becomes a registered adapter behind one interface, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. Adding one is a configuration change rather than a rewrite, and the default path requires no third party at all.

---

## What It Is

The final step: turning approved payslips and approved contractor invoices into **payment instructions a bank can actually execute**, tracking what was sent, and recording what came back.

**The default path is a bank batch file** — generated in the format the entity's jurisdiction uses, downloaded, uploaded to the bank's own portal by a person, and reconciled back into the product. No integration, no provider, no dependency.

That is not a fallback. **It is how the overwhelming majority of small agencies pay people today**, and building for it first means this feature works on day one rather than on the day a payment partnership closes.

---

## Problem It Solves

An approved payroll run is a set of correct figures with no route out of the product. Somebody reads them off a screen and types them into a banking portal, one by one, which is slow and is exactly where a digit gets transposed.

More consequentially: **once money has left, nothing in the product knows it.** A payslip stays notionally pending forever, and reconciling what was actually paid against what was calculated is a manual comparison nobody does.

---

## User-Facing Flows

### Creating a batch

A Finance Admin selects an approved run and creates a disbursement batch. **Where no approval exists, this is refused outright**, per [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]].

The batch shows what will be paid, grouped by currency and by payment method, with a total and a recipient count.

### The default path

**Generate a bank file.** The batch produces a file in the format configured for that entity's jurisdiction — SEPA, BACS, a local ACH equivalent, or a generic CSV where nothing specific is configured. Downloaded, uploaded to the bank, executed there.

### Marking as paid

Once the bank confirms, the Finance Admin marks the batch — or individual instructions — as paid, with the date. **Reconciliation is a deliberate action rather than an assumption**, and the batch shows its own gap plainly: sent, confirmed, outstanding.

### A provider path

Where a provider adapter is configured, the same batch initiates payment directly and receives outcomes back through the provider's own callback. **The batch's shape is identical either way.**

### A failure

An individual instruction can fail — a wrong account, a closed account, a rejected transfer — without affecting the rest. It surfaces with whatever reason the bank or provider gave, and is retried as its own instruction rather than by reissuing the whole batch.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Disbursement | Content + Panel | Batches |
| Batch detail | Content | Instructions and reconciliation |
| Payment methods | Section in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] | Per-entity configuration |

### Layout and components

**Batch detail** leads with a reconciliation strip: three figures in `mono-lg` — **total, confirmed, outstanding** — with outstanding rendering `attention` while non-zero.

That strip is the feature's most important element. The question a finance admin has after a payroll run is not what was calculated; it is **whether everyone actually got paid**, and until outstanding reads zero the answer is no.

Beneath, a Table of instructions: recipient, amount, currency, method, status Badge, reference. Failed instructions render `danger` and sort to the top with their reason stated and a **Retry** action.

**The primary action is contextual to the configured method.** Where a batch is file-based it reads **Generate bank file**, and after generation becomes **Mark as paid**. Where a provider is configured it reads **Send payments**. One action, whichever path.

Marking paid opens a Modal with a date picker defaulting to today and the count being confirmed — *Mark 34 payments as paid on 30 March* — because a bulk reconciliation should state its own scope before it commits.

**Payment methods** configuration is per entity: the file format, the sending account reference, and any provider selection. Plain, rarely visited, and consequential — a wrong format produces a file the bank rejects.

### Keyboard

Standard list bindings. No shortcut for sending or marking paid.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Finance-restricted. Owner and Finance Admin only — narrower than payroll itself, per Security below |
| Unapproved | Batch creation refused, naming the missing approval |
| Partially confirmed | The reconciliation strip shows the gap; the batch stays open |
| Empty | *No disbursement batches.* |
| Error | An instruction with no resolved amount is excluded from the file and reported, never sent as zero |

### Responsive

Desktop only below 1024px, and it says so.

---

## Technical Architecture

### DisbursementBatch

Finance-restricted, Tier 1.

```
batch_id:            UUID v4
workspace_id:        UUID
entity_id:           UUID, FK to Entity
source_type:         enum: PayRun, Invoice
source_node_id:      UUID
payment_method:      enum: BankFile, Provider, Manual
provider_reference:  string, nullable — which adapter, where one is configured
currency:            ISO 4217
total_amount:        decimal
instruction_count:   integer
status:              enum: Draft, Generated, Sent, PartiallyConfirmed,
                     Confirmed, Failed
generated_at / sent_at / confirmed_at: timestamps, nullable
file_reference:      string, nullable — the generated bank file per VPS-A006

— Universal Node Conventions per VPS-A002 —
```

### DisbursementInstruction

```
instruction_id:      UUID v4
workspace_id:        UUID
batch_id:            UUID
recipient_type:      enum: Employee, SubVendor
recipient_id:        UUID
pay_slip_id:         UUID, nullable
invoice_id:          UUID, nullable — exactly one of the two set
amount:              decimal
currency:            ISO 4217
status:              enum: Pending, Sent, Confirmed, Failed
external_reference:  string, nullable — opaque, from the bank or provider
failure_reason:      text, nullable
confirmed_at:        timestamp, nullable

— Universal Node Conventions per VPS-A002 —
```

### Bank account details are not in this graph

**The single most important architectural decision in this feature.**

Neither node carries an account number, a sort code, an IBAN or any payment credential. `recipient_id` points at an Employee or SubVendor; **the actual banking detail is held in the payment provider's own vault or, on the file path, entered by a person into their bank's portal.**

Where a file is generated, account details are read from a separately encrypted store at generation time, written into the file, and **never persisted into a graph node.** The file itself lives in object storage per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], encrypted client-side at Tier 1, and is subject to a short retention — days, not years — because a bank file is a list of every employee's account details in one place, which is the single most damaging artefact this product can produce.

### The adapter interface

Per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], every provider sits behind one interface in `packages/schema`:

```
DisbursementProvider {
  generateBatch(instructions) -> { fileContent, format } | { externalBatchId }
  reportOutcome(externalReference) -> { status, failureReason? }
}
```

The file path is an implementation of this interface, not an exception to it. **Adding a provider registers an adapter; it changes no schema and no calling code.**

### Approval is the hard gate

`disbursement.createBatch` requires an approved stage per [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] for a payroll source, or an approved invoice per [[VRS-F067_Contractor_Invoice_Management|VRS-F067]]. **Refused otherwise, at the write layer.**

This is the only path by which money leaves in this product, and a gate enforced anywhere other than at the write is a gate.

### Reconciliation

Marking paid sets instruction status and confirmed date. A batch becomes Confirmed only when every instruction is, and **PartiallyConfirmed otherwise** — a distinct state rather than a rounding of nearly-done to done, because the outstanding instruction is a person who has not been paid.

### API contracts

```
paymentMethod.configure(entityId, method, fileFormat?, providerReference?)
  -> { success }

disbursement.createBatch(sourceType, sourceNodeId) -> {
  batchId, instructionCount, totalAmount, excluded: { reason, count }[]
}
  // Refused without approval. Instructions with no resolved amount
  // are excluded and reported, never included at zero

disbursement.generateFile(batchId) -> { fileReference, format }
  // Reads banking details from the encrypted store at generation.
  // No detail is persisted into any graph node

disbursement.sendViaProvider(batchId) -> {
  sent: { instructionId, externalReference }[],
  failed: { instructionId, reason }[]
}

disbursement.markPaid(batchId, paidDate, instructionIds?) -> {
  confirmed, remaining
}
  // Whole batch or specific instructions

disbursement.reportOutcome(instructionId, status, reference?, failureReason?)
  -> { success }
  // Called by a provider adapter's callback

disbursement.retry(instructionId) -> { instructionId }
  // Creates a fresh instruction in a new batch. Never mutates a failed one
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Both node types carry the schemas above |
| G02 | **Neither node carries a bank account number, IBAN, sort code or any payment credential.** Banking details live in an encrypted store outside the graph or in a provider's own vault |
| G03 | A generated bank file is Tier 1, encrypted client-side, held in object storage per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] under a short retention distinct from every other document class |
| G04 | Batch creation requires an approved stage per [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] or an approved invoice per [[VRS-F067_Contractor_Invoice_Management|VRS-F067]], enforced at the write layer |
| G05 | Every provider, including the file path, implements the same adapter interface per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. No feature calls a vendor SDK |
| G06 | An instruction with no resolved amount is excluded and reported, never sent at zero |
| G07 | A batch reaches Confirmed only when every instruction is. PartiallyConfirmed is a distinct persisted state |
| G08 | A retry creates a fresh instruction. A failed instruction is never mutated, so the failure record survives |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F066-S01 | Batch and instruction schemas | Data |
| VRS-F066-S02 | Bank file generation | Logic |
| VRS-F066-S03 | Provider adapter interface | Platform |
| VRS-F066-S04 | Reconciliation | UI |
| VRS-F066-S05 | Failure handling and retry | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an approved payroll run
**WHEN** a batch is created
**THEN** one instruction exists per payslip with a resolved amount, and any payslip without one is excluded and reported

---

**GIVEN** a run that is finalized but not approved
**WHEN** batch creation is attempted
**THEN** it is refused at the write layer, naming the missing approval

---

**GIVEN** a batch on the file path
**WHEN** a bank file is generated
**THEN** it contains the banking details required by the configured format, those details are read from the encrypted store at generation, and **no account number is written into any graph node**

---

**GIVEN** that file
**WHEN** it is inspected in object storage
**THEN** it is unreadable ciphertext, and it is subject to a retention measured in days

---

**GIVEN** 34 instructions of which 32 are confirmed
**WHEN** the batch is viewed
**THEN** its status is PartiallyConfirmed, the reconciliation strip shows 2 outstanding in `attention`, and the batch does not read as complete

---

**GIVEN** an instruction fails with a rejected account
**WHEN** the outcome is recorded
**THEN** that instruction alone is Failed with the reason stated, every other instruction is unaffected, and a retry creates a fresh instruction rather than mutating it

---

**GIVEN** a provider adapter is configured for an entity
**WHEN** a batch is sent
**THEN** it uses the same interface the file path implements, and no vendor SDK appears in this feature's code

---

**GIVEN** a Manager or HR Admin attempts to view a batch
**WHEN** the request is made
**THEN** it is structurally absent. This surface is Owner and Finance Admin only

---

## Non-Functional Requirements

- Batch creation completes within 5 seconds for 150 instructions
- File generation completes within 10 seconds and runs client-side, since it reads Tier 1 amounts and encrypted banking details
- Batch creation, viewing and marking paid function offline. Provider sending requires connectivity
- A generated file's retention is configurable in days and defaults to 7

---

## Security Considerations

- **Keeping banking details out of the graph is the central decision.** A graph node holding every employee's account number would be the highest-value target in this product, synced to devices, and outside the encryption model that protects compensation. Details live in an encrypted store keyed separately, or in a provider's vault, and reach the graph never.
- **A generated bank file is the most dangerous artefact this product creates** — every employee's account details, in one file, in one place. Tier 1, client-side encrypted, short retention, and audited on every access. The retention default of seven days is deliberately shorter than any other document class in the product.
- **This surface is Owner and Finance Admin only — narrower than payroll itself.** HR Admin holds full access to a payroll run, correctly, because they own employment records. Releasing money is a different authority, and this is the one place in the product where HR Admin is deliberately excluded from something adjacent to their own domain.
- **Approval is enforced at the write layer.** This is the only path by which money leaves, and a gate enforced in an interface is not a gate.
- **A failed instruction is never mutated.** The failure record survives the retry, because *this payment failed and was reissued* is a materially different fact from *this payment succeeded on the second attempt*, and only the first is honest.

---

## Out of Scope

- **Executing payments directly.** This generates instructions and files, or hands a payload to an adapter. The money moves through a bank or a provider
- **Storing or validating bank account details** — held in an encrypted store this feature reads at generation and never persists
- **Banking compliance, KYC or sanctions screening** — the provider's or the bank's
- **Which provider is eventually used** — a commercial decision made behind the adapter
- **Payment scheduling or recurring instructions** — a batch is created from an approved source and sent. Scheduling would decouple release from approval
- **Reconciliation against a bank statement feed** — marking paid is a deliberate human action

---

## Decisions Recorded

**This feature is new and replaces the [[Vulto Pay]] dependency entirely.** That service is planned years out, and a payroll engine that can only pay through infrastructure that does not exist cannot pay anyone.

**The bank file is the default path, not a fallback.** It is how the overwhelming majority of small agencies pay people today, and building for it first means this works on day one rather than on the day a payment partnership closes.

**Banking details are not in the graph.** The obvious implementation — an account number field on Employee — would create the highest-value target in the product, synced to devices, outside the encryption model protecting compensation.

**The generated file carries its own short retention**, deliberately shorter than any other document class. It is a list of every employee's account details in one place.

**HR Admin is excluded from this surface** despite holding full access to payroll runs. Releasing money is a different authority from owning employment records, and this is the one place the two are deliberately separated.

**A retry creates a fresh instruction rather than mutating the failed one.** *This failed and was reissued* is a different fact from *this succeeded on the second attempt*, and only the first is true.

---

## Related Notes

- [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] — the approval this feature is gated on
- [[VRS-F064_Multi-Currency_Payroll|VRS-F064]] — the currency resolution feeding instruction amounts
- [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] — contractor invoices, the second source
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the provider abstraction
