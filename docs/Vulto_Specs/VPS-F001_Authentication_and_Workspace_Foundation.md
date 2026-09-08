---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-08-17]]"
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

In graph terms: authentication creates the User node associated with the account. Workspace creation creates the Workspace node containing every other node in that tenant. Role assignment creates a lifecycle-bearing WorkspaceMembership node plus `membership_of` and `membership_in` endpoint edges that [[VPS-A004_Graph_Permission_Layer|VPS-A004]] enforces against. Device registration initializes the local graph store per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], keyed to that device's own session.

---

## Problem It Solves

Without this feature no user can access the product, no container exists for employees or assignments, the permission layer has no roles to enforce, and the local-first architecture has no mechanism to initialize, key or revoke a device's local store. There is no alternative implementation path.

---

## User-Facing Flows

### Sign-up

A person creates an account by email and password, by Google, or by passkey. On success a User node exists and they proceed directly into workspace creation. Email verification runs in the background and gates nothing at MVP — blocking a founder from setting up their workspace while an email round-trips is a real onboarding cost with no proportionate security benefit at this stage.

### Workspace creation

The founding user names their workspace. This single action atomically creates the Workspace node, a WorkspaceMembership node assigning that user the Owner role, and its `membership_of` and `membership_in` endpoint edges. This is the only WorkspaceMembership that can never be deleted.

Workspace creation hands off directly to [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s setup wizard, which collects the four configuration questions and offers data import. This feature ends at the point a workspace exists with one Owner in it.

### Tier 1 key establishment

Because the Owner will hold compensation data, [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 1 key material is established during initial setup rather than deferred to the first payroll run. The flow generates the recovery artifact, requires correct re-entry before proceeding, and prompts for a second Tier 1 holder framed as business continuity — *so a lost laptop never locks your business out of its own payroll history*. Declining requires an explicit acknowledgment.

### Team invitation and role assignment

An Owner, or a user with sufficient permission, invites a team member by email and assigns a role at the point of invitation. The invited person receives a link; accepting it creates their User node if none exists, their session, and their WorkspaceMembership node with both endpoint edges, in one flow.

Manager is never assigned as a membership role. It is derived automatically from the `managed_by` edge structure: any Employee who is the target of at least one active `managed_by` edge holds Manager permissions over those reports, evaluated at query time by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]. Before [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] exists there are no Manager-scoped reports to authorize, so no temporary stored grant is needed.

### Device registration and multi-device sync

Every device authenticating into a workspace for the first time registers as a Device node and initializes its own local graph store. When an authenticated user opens Roster on a second device, the workspace graph — filtered by their role and by [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s tier rules — begins syncing before any data surface is interactive. The user sees the syncing state defined in [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], never a blank or broken screen.

Device registration is scoped by `application`, because the same physical laptop running Roster and [[Vulto Accounts]] presents two separate web origins and needs two independently synced, independently revocable local graphs.

### Session expiry and offline access

Database-backed sessions have a seven-day rolling lifetime and refresh after one day of use. Authorization never accepts a cookie-cached session shortcut. On expiry the user re-authenticates; the local store remains fully intact and readable throughout. Nothing is wiped on expiry — only on explicit revocation or offboarding.

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

- **Email and password** — built-in credential provider using Better Auth's default scrypt hashing. Passwords never enter the graph, only Better Auth's credential store.
- **Google SSO** — OAuth plugin, scoped to email and basic profile only. No broader Workspace data is requested because none is needed.
- **Passkey / WebAuthn** — Better Auth's passkey plugin, never a bespoke implementation. Credentials bind to the device's secure hardware and unlock via platform biometrics or device passcode. **Required, not optional**: [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 3 key derivation depends on WebAuthn PRF.
- **Workspace admission control** — Better Auth's organization/member tables are the online admission and revocation control plane. Workspace and WorkspaceMembership are deterministic local graph projections with the same stable identifiers and role enum. A grant admits only after its graph projection is confirmed; removal denies centrally before projection completes. A disagreement fails closed. The local graph preserves history but never overrules a central removal.
- **Sessions** — host-only secure httpOnly cookies on web, platform keychain on native. Database-backed sessions have a seven-day rolling lifetime, refresh after one day of use and do not use Better Auth's cookie cache for authorization. Tokens never enter the graph or application-visible JSON. After every cold restart, the server validates the current database session, active user, exact workspace and fully confirmed active membership before releasing or deriving volatile local-store unwrap material; a revoked session or membership receives none.

### Graph model

User, Workspace, WorkspaceMembership and Device are registered in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]. This document does not restate their schema.

Device carries: `device_id`, `user_id`, `device_name`, `platform`, `application` (default `VultoRoster`), `push_token` (nullable, mobile only, invalidated on revocation), `registered_at`, `last_active_at`, `is_revoked`.

**Device, like Workspace and WorkspaceMembership, is a Better Auth control-plane record whose local graph-node projection is deferred to [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]/FDN-85.** FDN-63 implements it as a Postgres `device` table carrying the fields above, distinct from [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s per-workspace `device_unlock_secret`: one identity row per `(user, application)`, one unlock secret per workspace under it. Device trust, the online unlock gate and the revocation signal read this row and the server session grant, not a graph node. Recorded as F189. The Devices management screen below is built by FDN-63 as a standalone session-gated route ahead of the full application shell (F190).

### Sync behavior

User, WorkspaceMembership and Device are Tier 0. Workspace's display fields are Tier 0; its administrative fields are Tier 2. None require end-to-end encryption. The local store's AES-256 encryption, unlocked through a server-authorized session checkpoint per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], is what protects a lost device, independent of any node's tier. The encrypted store remains locked after every cold restart until that online checkpoint succeeds; afterward the complete product operates offline until the next cold restart.

### Permission model

Role assignment at invitation creates the WorkspaceMembership node and its `membership_of` and `membership_in` endpoint edges. [[VPS-A004_Graph_Permission_Layer|VPS-A004]] reads that local projection for subsequent offline queries, while online admission checks the corresponding central membership row. This feature implements no permission logic of its own; it produces the one synchronized role input the permission layer consumes. Owner is capped at three per workspace, enforced here at invitation and promotion.

### API contracts

```
auth.signUp(email, password)                    -> { user }
auth.signUpWithGoogle(oauthCode)                -> { user, session }
auth.beginPasskeyRegistration(name, email)      -> { signedSingleUseContext }
auth.registerPasskey(signedSingleUseContext)    -> { credential }
auth.signIn(email, password)                    -> { user, session }
auth.signInWithPasskey(assertion)               -> { user, session }
auth.signOut()                                  -> { success }
auth.revokeAllSessions()                        -> { success }
auth.requireCurrentWorkspaceSession(requestHeaders, workspaceId)
                                                -> { sessionId, userId, workspaceId, membershipId }
  // Server-only. The browser cookie supplies the credential; session output is public metadata only.

workspace.create(name)                          -> { workspaceId }
  // Atomic: Workspace node + WorkspaceMembership node + membership_of + membership_in

workspace.inviteMember(workspaceId, email, role) -> { invitationId }
  // Rejects if role=Owner and the workspace already holds 3

workspace.acceptInvitation(invitationId)        -> { user, workspaceId, session }
workspace.changeMemberRole(membershipId, role)  -> { success }

tier1Keys.initialize()                          -> { recoveryArtifact }
tier1Keys.verifyArtifact(entered)               -> { verified }
tier1Keys.addRecoveryHolder(holderId)            -> { success }

device.register(deviceName, platform, application?, pushToken?) -> { deviceId }
  // User and session identity derive from the httpOnly cookie on the request.
  // The device may supply its own generated identifier; absent one, the server
  // mints it and the device adopts it.
device.revoke(workspaceId, deviceId, reason?)   -> { success }
  // Owner-gated and WORKSPACE-SCOPED (F191). Revokes this workspace's unlock
  // secret only; the device keeps its access to every other workspace.
  // `reason: "stale"` records a reversible staleness revocation.
device.retire(deviceId)                         -> { success }
  // GLOBAL, and available only to the device's own user (F191). Sets
  // `is_revoked`, clears `push_token`, revokes every unlock secret the device
  // holds. An Owner may not invoke this against a colleague's device.
device.reapprove(workspaceId, deviceId)         -> { success }
  // Owner-gated. Reverses a staleness revocation in this workspace, and only
  // when the device's most recent trust event here is `stale-flagged`.
device.listForWorkspace(workspaceId)
    -> { devices: Device[], viewerIsOwner, viewerUserId }
  // `viewerIsOwner` is a rendering capability so the screen need not guess
  // which actions to offer; every action re-derives it server-side. The
  // records omit `push_token`, which no listing has any use for.
```

**Device revocation is two separately authorized actions, not one (F191).** A workspace Owner may cut a device off from *their* workspace; only the person who owns the device may retire it everywhere. The `device` record spans workspaces, so a global flag settable by any Owner would let one client of a professional-services firm destroy another client's local data on the same laptop. Both are Modal-confirmed, with copy naming their own scope rather than a shared "this cannot be undone."

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | A User node is created on account creation. Passwords are never stored in the graph, only a reference sufficient to confirm the corresponding Better Auth credential exists |
| G02 | A lifecycle-bearing WorkspaceMembership node carries the role property and connects to User through `membership_of` and Workspace through `membership_in`. This is the activation structure for [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s matrix |
| G03 | A Device node is created when a new device authenticates, carrying the fields above. `application` distinguishes registrations for different suite applications on the same physical device |
| G04 | The local store is encrypted with AES-256 per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. After every cold restart it remains locked until the server validates a current authenticated session and releases or derives volatile unwrap material. The raw session token, plaintext storage key and unwrap material are never persisted alongside the data or exposed to application code. Revocation wipes the store entirely within 60 seconds of signal receipt; after a cold restart, a revoked session cannot reopen it even before a wipe signal arrives |
| G05 | Workspace creation atomically generates the Workspace node, the founding Owner's WorkspaceMembership node and its `membership_of` and `membership_in` edges. This membership cannot be deleted |
| G06 | Manager is derived, not stored. Any Employee targeted by at least one active `managed_by` edge holds Manager permissions over those reports, evaluated at query time by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]. Manager is absent from the stored membership-role enum |

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

**GIVEN** the device completed its online, session-authorized local-store unlock after the current cold start and is now offline
**WHEN** the user opens or continues using the app without another cold restart
**THEN** it opens from the local store, the full product is accessible, no login prompt appears, and the Offline indicator shows

---

**GIVEN** the device cold-restarts while offline
**WHEN** the user attempts to open Vulto
**THEN** the encrypted local store remains locked until connectivity returns and the server validates the current session

---

**GIVEN** the user's membership has been revoked centrally
**WHEN** they cold-restart Vulto and attempt an online unlock
**THEN** the session check is denied and no local graph data is decrypted

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
- After one online, session-authorized unlock per cold start, the complete local graph remains available offline until the next cold restart
- Device wipe completes within 60 seconds of signal receipt, online or on next connection

---

## Security Considerations

- **Email verification is asynchronous**, not a gate on workspace creation. An unverified address is flagged in account settings and blocks nothing at MVP.
- **Device trust has no silent auto-approval.** Every device explicitly registers and appears in the device management view. No path grants access without `device.register`.
- **Invitation links expire** after 7 days and are single-use. An accepted or expired link returns an identical response, so a link cannot be used to probe whether an address is already a member.
- **Revocation fires on Tier 1 access change**, not only offboarding, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. A demotion removing Finance Admin is a revocation event in its own right.
- **Role changes take effect immediately in an online session, with no cold restart required.** A narrowing role change — the same case the line above names as a revocation event — reaches an already-unlocked device live, within the same bound specified for device wipe: within 60 seconds while online, or on next connection. This does not, and cannot, mean an offline device learns of a server-side change with no data transfer; offline role staleness is bounded the same way F106 already bounds staleness of the unlock key itself, and resolves the next time the device is online. Per [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s A004-T06, whose "active sessions must not require restart" binds to the graph query layer — which in this architecture is the local interceptor, since [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] makes the server "a coordination layer, never a source of truth" that serves no graph queries of its own. Recorded as F127, which also names the open question of which issue owns the live delivery channel this requires.

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

**Cold restart is a revocation checkpoint.** Every cold restart requires one online, server-authorized local-store unlock. This prevents an offboarded person from continuing to decrypt salaries, grievance cases, wellness records or performance reviews solely with a local credential after central access has been revoked. The accepted availability cost is limited to the intersection of a cold restart and no connectivity; once unlocked, the full day continues offline. Credential-bound WebAuthn PRF unlock is not the default and is not being built now. It may be added later as an explicit capability if customer evidence warrants it: adding that option expands access, while removing it after customers rely on it would take access away.

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
