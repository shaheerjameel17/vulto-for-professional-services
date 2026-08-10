---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Platform
aliases:
  - VPS-F001
---

# VPS-F001 — Authentication and Workspace Foundation

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (Better Auth, tRPC, the sync engine), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (User, Workspace, WorkspaceMembership and Device registry entries), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (device-local encryption, sync behavior, Tier 1 key setup), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (role definitions and permission enforcement), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (transactional email for invitations), [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] (application shell)
**Blocks:** Every other feature without exception. Nothing else can be built, tested or demonstrated before this exists.

This document is the single source of truth for this feature. **One identity, one workspace, one role, across every application in the suite.** Vulto Accounts does not get its own login.

---

## What It Is

Authentication and Workspace Foundation establishes identity, session management, workspace structure, team membership, role assignment and device trust.

In graph terms: authentication creates the User node that owns a session. Workspace creation creates the Workspace node containing every other node in that tenant. Role assignment creates the WorkspaceMembership edge that [[VPS-A004_Graph_Permission_Layer|VPS-A004]] enforces against. Device registration initializes the local graph store per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], keyed to that device's own session.

---

## Problem It Solves

Without this feature no user can access the product, no container exists for employees or assignments, the permission layer has no roles to enforce, and the local-first architecture has no mechanism to initialize, key or revoke a device's local store. There is no alternative implementation path.

---

## User-Facing Flows

### Sign-up

A person creates an account by email and password, by Google, or by passkey. On success a User node exists and they proceed directly into workspace creation. Email verification runs in the background and gates nothing at MVP — blocking a founder from setting up their workspace while an email round-trips is a real onboarding cost with no proportionate security benefit at this stage.

### Workspace creation

The founding user names their workspace. This single action atomically creates the Workspace node and a WorkspaceMembership edge assigning that user the Owner role. This is the only WorkspaceMembership that can never be deleted.

Workspace creation hands off directly to [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s setup wizard, which collects the four configuration questions and offers data import. This feature ends at the point a workspace exists with one Owner in it.

### Tier 1 key establishment

Because the Owner will hold compensation data, [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 1 key material is established during initial setup rather than deferred to the first payroll run. The flow generates the recovery artifact, requires correct re-entry before proceeding, and prompts for a second Tier 1 holder framed as business continuity — *so a lost laptop never locks your business out of its own payroll history*. Declining requires an explicit acknowledgment.

### Team invitation and role assignment

An Owner, or a user with sufficient permission, invites a team member by email and assigns a role at the point of invitation. The invited person receives a link; accepting it creates their User node if none exists, their session, and their WorkspaceMembership edge, in one flow.

Manager is not assigned manually once [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] exists. It is derived automatically from the `managed_by` edge structure: any Employee who is the target of at least one active `managed_by` edge holds Manager permissions over those reports, evaluated at query time by [[VPS-A004_Graph_Permission_Layer|VPS-A004]] rather than stored as a membership role. Before [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] exists, Manager may be assigned manually, and that manual grant is superseded — not merged — the first time a `managed_by` edge names that person.

### Device registration and multi-device sync

Every device authenticating into a workspace for the first time registers as a Device node and initializes its own local graph store. When an authenticated user opens Roster on a second device, the workspace graph — filtered by their role and by [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s tier rules — begins syncing before any data surface is interactive. The user sees the syncing state defined in [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], never a blank or broken screen.

Device registration is scoped by `application`, because the same physical laptop running Roster and [[Vulto Accounts]] presents two separate web origins and needs two independently synced, independently revocable local graphs.

### Session expiry and offline access

Session tokens expire on a defined schedule. On expiry the user re-authenticates; the local store remains fully intact and readable throughout. Nothing is wiped on expiry — only on explicit revocation or offboarding.

If the device is offline with a valid session, the full product remains usable from the local graph with the Offline indicator shown and no login prompt interrupting work.

### Device revocation

An Owner revokes a device from the device management view. The Device node is marked revoked, a revocation signal is queued, and the local store is wiped within 60 seconds of the signal being received — whether the device is online at the moment of revocation or reconnects later.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Sign-up / Sign-in | Full-bleed, no shell | Pre-authentication |
| Workspace creation | Full-bleed, no shell | Single field, single action |
| Tier 1 key setup | Full-bleed, no shell | Recovery artifact and second holder |
| Members | Content + Panel | Invite, list, change role |
| Devices | Content | List and revoke |

### Layout and components

Pre-authentication screens are single-column, 400px maximum, vertically centered, on `bg-canvas`. No marketing content, no illustration, no product tour. A person reaching this screen has already decided.

**Sign-in** presents passkey as the primary action where the browser supports it, with email and Google beneath as `secondary`. This ordering is deliberate and inverts the usual convention: passkey is faster, is required infrastructure for [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 3 key derivation anyway, and every person who adopts it at sign-up is one fewer password in the product.

**Members** is a Table per [[VPS-D002_Component_Library|VPS-D002]] — avatar, name, email, role Badge, last active — with a Panel opening on row selection for role change and removal. The primary action is **Invite member**. Role selection uses a Select rather than a Toggle Group, since five options exceed the Toggle Group's ceiling.

**Devices** is a Table — device name, platform, application, last active, registered — with a `danger` **Revoke** action requiring a Modal confirmation. This is one of the few flows in this product that warrants a modal: revocation is destructive, irreversible from the user's side, and wipes a colleague's local data.

**Tier 1 key setup** displays the recovery artifact once, in `numeric`, on a `raised` Card with a **Download** action, followed by a re-entry Input that must match before **Continue** enables. The second-holder prompt is a separate step, not a checkbox on the same screen, because a checkbox is dismissed without reading and a step is not.

### Keyboard

Global bindings from [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] apply once authenticated. Pre-authentication screens support `Enter` to submit and `Tab` ordering only. Members and Devices support `J`/`K` row navigation and `Enter` to open the Panel.

### System states

| State | Treatment |
|---|---|
| Syncing | Initial device sync shows the Skeleton shell with the sidebar rendered and content skeletal, per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] |
| Restricted | Non-Owner viewing Devices sees only their own devices, with no indication others exist |
| Aged out | Not applicable — no Tier 1 content on these surfaces |
| Empty | Members is never empty. Devices with one entry shows that entry, never an empty state |
| Error | Invitation failures state the cause: address already a member, Owner limit reached, invitation expired |

### Responsive

Members drops `last active`, then `email`, below 1280px. Devices drops `registered`, then `platform`. Both remain usable to 1024px, below which [[VPS-F011_Mobile-Native_Experience|VPS-F011]] is the intended experience.

---

## Technical Architecture

### Authentication

Better Auth per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]:

- **Email and password** — built-in credential provider, bcrypt hashing. Passwords never enter the graph, only Better Auth's credential store.
- **Google SSO** — OAuth plugin, scoped to email and basic profile only. No broader Workspace data is requested because none is needed.
- **Passkey / WebAuthn** — Better Auth's passkey plugin, never a bespoke implementation. Credentials bind to the device's secure hardware and unlock via platform biometrics or device passcode. **Required, not optional**: [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 3 key derivation depends on WebAuthn PRF.
- **Workspace as Organization** — Better Auth's organizations plugin maps directly onto Workspace and WorkspaceMembership. The organization member role is the same value [[VPS-A004_Graph_Permission_Layer|VPS-A004]] reads. There is exactly one role system, not two that can drift.
- **Sessions** — secure httpOnly cookies on web, platform keychain on native. Tokens never enter the graph.

### Graph model

User, Workspace, WorkspaceMembership and Device are registered in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]. This document does not restate their schema.

Device carries: `device_id`, `user_id`, `device_name`, `platform`, `application` (default `VultoRoster`), `push_token` (nullable, mobile only, invalidated on revocation), `registered_at`, `last_active_at`, `is_revoked`.

### Sync behavior

User, WorkspaceMembership and Device are Tier 0. Workspace's display fields are Tier 0; its administrative fields are Tier 2. None require end-to-end encryption. The local store's AES-256 encryption, keyed from the session per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], is what protects a lost device, independent of any node's tier.

### Permission model

Role assignment at invitation creates the WorkspaceMembership edge [[VPS-A004_Graph_Permission_Layer|VPS-A004]] reads for every subsequent query in the product. This feature implements no permission logic of its own; it produces the one input the permission layer consumes. Owner is capped at three per workspace, enforced here at invitation and promotion.

### API contracts

```
auth.signUp(email, password)                    -> { userId, sessionToken }
auth.signUpWithGoogle(oauthCode)                -> { userId, sessionToken }
auth.registerPasskey(userId)                    -> { credentialId }
auth.signIn(email, password)                    -> { sessionToken }
auth.signInWithPasskey(assertion)               -> { sessionToken }
auth.signOut()                                  -> { success }

workspace.create(name)                          -> { workspaceId }
  // Atomic: Workspace node + WorkspaceMembership(role=Owner), one transaction

workspace.inviteMember(workspaceId, email, role) -> { invitationId }
  // Rejects if role=Owner and the workspace already holds 3

workspace.acceptInvitation(invitationId)        -> { userId, workspaceId, sessionToken }
workspace.changeMemberRole(membershipId, role)  -> { success }

tier1Keys.initialize(userId)                    -> { recoveryArtifact }
tier1Keys.verifyArtifact(userId, entered)       -> { verified }
tier1Keys.addRecoveryHolder(userId, holderId)   -> { success }

device.register(sessionToken, deviceName, platform, application?, pushToken?) -> { deviceId }
device.revoke(deviceId)                         -> { success }
device.listForWorkspace(workspaceId)            -> Device[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | A User node is created on account creation. Passwords are never stored in the graph, only a reference sufficient to confirm the corresponding Better Auth credential exists |
| G02 | A WorkspaceMembership edge connects User to Workspace and carries the role property. This is the activation edge for [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s matrix |
| G03 | A Device node is created when a new device authenticates, carrying the fields above. `application` distinguishes registrations for different suite applications on the same physical device |
| G04 | The local store is encrypted with AES-256 keyed from the session token per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], never stored alongside the data. Revocation wipes it entirely within 60 seconds of signal receipt |
| G05 | Workspace creation atomically generates the Workspace node and the founding Owner's WorkspaceMembership. This membership cannot be deleted |
| G06 | Manager is derived, not stored. Any Employee targeted by at least one active `managed_by` edge holds Manager permissions over those reports, evaluated at query time by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]. A manual Manager membership assigned before [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] exists is superseded by derivation, never merged with it |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F001-S01 | Email and password authentication | Security |
| VPS-F001-S02 | Google SSO | Security |
| VPS-F001-S03 | Passkey and WebAuthn authentication | Security |
| VPS-F001-S04 | Workspace creation | Logic |
| VPS-F001-S05 | Invitation and role assignment | Logic |
| VPS-F001-S06 | Tier 1 key establishment and recovery setup | Security |
| VPS-F001-S07 | Device trust and local store management | Security |

---

## Feature Acceptance Criteria

**GIVEN** a new user completes sign-up
**WHEN** the account is created
**THEN** a User node exists, a Workspace node exists, a WorkspaceMembership links them with role Owner, and they arrive at [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s setup wizard, within 3 seconds

---

**GIVEN** an Owner completes Tier 1 key setup
**WHEN** the recovery step is reached
**THEN** the artifact is displayed once, correct re-entry is required before continuing, and a second Tier 1 holder is prompted for with an explicit acknowledgment required to decline

---

**GIVEN** an authenticated user opens Roster on a second device
**WHEN** authentication completes
**THEN** a Device node is created, the local store is initialized, and the graph filtered by role and tier begins syncing before any product surface is interactive

---

**GIVEN** an Owner revokes a device
**WHEN** revocation is confirmed
**THEN** the Device node is marked revoked, a signal is sent, and the local store is wiped within 60 seconds of receipt regardless of whether the device was online at revocation

---

**GIVEN** an Employee is named as the target of a `managed_by` edge in [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]
**WHEN** they next issue a query
**THEN** [[VPS-A004_Graph_Permission_Layer|VPS-A004]] grants them Manager permissions scoped to those reports, with no membership role change required and no manual assignment consulted

---

**GIVEN** a session expires while the app is open
**WHEN** expiry occurs
**THEN** the user is prompted to re-authenticate, the local store remains intact and readable throughout, and no sync is interrupted

---

**GIVEN** the device is offline with a valid session
**WHEN** the user opens the app
**THEN** it opens from the local store, the full product is accessible, no login prompt appears, and the Offline indicator shows

---

**GIVEN** an Owner attempts to invite a fourth Owner
**WHEN** the invitation is submitted
**THEN** it is rejected with an error naming the three-Owner maximum

---

## Non-Functional Requirements

- Sign-up and workspace creation complete within 3 seconds end to end
- Sign-in completes within 2 seconds; passkey sign-in within 1 second
- All authentication traffic over HTTPS; sync over TLS 1.3 minimum
- Passwords stored only via Better Auth, never in the graph, never in plaintext
- Valid sessions allow full offline local graph access without re-authentication
- Device wipe completes within 60 seconds of signal receipt, online or on next connection

---

## Security Considerations

- **Email verification is asynchronous**, not a gate on workspace creation. An unverified address is flagged in account settings and blocks nothing at MVP.
- **Device trust has no silent auto-approval.** Every device explicitly registers and appears in the device management view. No path grants access without `device.register`.
- **Invitation links expire** after 7 days and are single-use. An accepted or expired link returns an identical response, so a link cannot be used to probe whether an address is already a member.
- **Revocation fires on Tier 1 access change**, not only offboarding, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. A demotion removing Finance Admin is a revocation event in its own right.
- **Role changes take effect immediately** on the next query, with no session restart, per [[VPS-A004_Graph_Permission_Layer|VPS-A004]].

---

## Out of Scope

- SAML and SCIM — Post-MVP, for enterprise clients
- Two-factor authentication beyond passkey — Post-MVP
- Social login beyond Google — Post-MVP
- Workspace custom domains — Post-MVP
- Custom role creation — roles are fixed per [[VPS-A004_Graph_Permission_Layer|VPS-A004]]; workspace-defined roles are a Mature-phase concern
- The setup wizard and data import — [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]
- Workspace configuration beyond name — [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]

---

## Decisions Recorded

**Manager auto-assignment is resolved**, closing this document's only open item. Manager is a derived permission evaluated from `managed_by` at query time, never a stored membership role. The previous framing left it ambiguous whether a manual assignment and a derived one could coexist; G06 states that derivation supersedes rather than merges, which prevents a stale manual grant outliving the reporting line that justified it.

**Passkey is the primary sign-in method**, not an alternative. [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 3 key derivation requires WebAuthn PRF, so the capability is mandatory infrastructure regardless; presenting it first converts that cost into the fastest sign-in path in the product.

**Tier 1 key establishment moves into initial setup.** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] requires the recovery artifact and second-holder prompt, and the only moment an Owner is reliably paying attention to setup is during setup.

---

## Related Notes

- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission layer this feature's roles activate
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the encryption and key model established here
- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — Employee profiles, which supersede manual Manager assignment
- [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] — the setup wizard this feature hands off to
- [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] — workspace configuration
