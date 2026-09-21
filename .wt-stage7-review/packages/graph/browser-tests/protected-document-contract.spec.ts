import { expect, test } from "@playwright/test";
import postgres from "postgres";
import {
  createWorkspaceMembership,
  databaseUrl,
  signUp,
  unlockAndWaitForReady,
  webOrigin,
} from "./browser-test-helpers";

declare global {
  interface Window {
    __vultoWorkerDiagnostics?: {
      runProtectedDocumentProof(subjectUserId: string): Promise<{
        readerSetId: string;
        canonicalHeader: string;
        tier1RoundTrip: boolean;
        tier1SharedVectorMatches: boolean;
        stage3PartitionsAfterReopen: number;
        stage3EpochAfterReopen: number;
        stage3RemovedReaderDenied: boolean;
        stage3OldKeyDenied: boolean;
        stage3DocumentBUnaffected: boolean;
        stage3WorkspaceUnaffected: boolean;
        stage3WorkspaceDocumentStayedTier02: boolean;
        stage3AddressMappingRestored: boolean;
        stage3PostReopenWriteSurvived: boolean;
        stage3HistoryStayedLazy: boolean;
        stage3ManifestStayedSealed: boolean;
        stage3UnauthorizedOnlyMaterializationDenied: boolean;
        stage3UnauthorizedOnlyOpenDenied: boolean;
        stage3WrongWorkspaceDenied: boolean;
        stage6ImmediateReaderGrant: boolean;
        stage6RetentionLifecycle: boolean;
        stage6CryptographicErasure: boolean;
        stage6IntegratedColdReopen: boolean;
        tier3EnrollmentSubjectOnly: boolean;
        tier3PrfPersistentReopen: boolean;
        tier3MandatoryRecoveryConfirmed: boolean;
        tier3RecoverySubjectOnly: boolean;
        tier3WrongRecoveryCodeDenied: boolean;
        tier3OldRecoveryPathDenied: boolean;
        tier3RetiredCredentialDenied: boolean;
        tier3PostRecoveryEpoch: number;
        tier3PostRecoveryWriteSurvived: boolean;
        tier3UnrelatedDocumentSurvived: boolean;
        tier3WorkspaceStateSurvived: boolean;
        tier3GenerationHistoryValidated: boolean;
        tier3RootRotated: boolean;
        tier3KeysStayedWorkerPrivate: boolean;
        tier3WindowCeremonyBuffersDetached: boolean;
      }>;
      runAdversarialDurabilityProof(
        subjectUserId: string,
        workspaceId?: string,
      ): Promise<{
        createdPartitions: number;
        privateKeyExtractable: boolean;
        durableManifestPresentAfterTermination: boolean;
        materializedPartitionsAfterTermination: number;
        identityRestoredAfterTermination: boolean;
        restoredPrivateKeyExtractable: boolean;
        failedPersistRejected: boolean;
        failedPersistMutatedMemory: boolean;
        failedPersistLeftDurableStateUnchanged: boolean;
        concurrentWritesBothSucceeded: boolean;
        concurrentExactlyOneSucceeded: boolean;
        generationAfterTwoConcurrentWrites: number | null;
        coldRollbackAcceptedAfterWorkerRestart: boolean;
      }>;
      prepareIdentityTransferSource(
        workspaceId: string,
        subjectUserId: string,
      ): Promise<{ sessionId: string; deviceId: string }>;
      prepareIdentityTransferTarget(
        workspaceId: string,
        subjectUserId: string,
        sourceDeviceId: string,
        transferId: string,
      ): Promise<{
        sessionId: string;
        targetDeviceId: string;
        targetTransferPublicKey: string;
      }>;
      createIdentityTransfer(
        sessionId: string,
        input: Record<string, unknown>,
      ): Promise<Record<string, unknown>>;
      acceptIdentityTransfer(
        sessionId: string,
        input: Record<string, unknown>,
      ): Promise<Record<string, unknown>>;
      runFailedSecurityTransitionProof(
        workspaceId: string,
        subjectUserId: string,
      ): Promise<Record<string, unknown>>;
      runConcurrentSecurityRaceProof(
        workspaceIds: readonly [string, string, string],
        subjectUserId: string,
      ): Promise<Record<string, unknown>>;
    };
  }
}

test("FDN-52 stages 1-6A — a real Worker proves the integrated protected lifecycle", async ({
  page,
  context,
  browser,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        ctap2Version: "ctap2_1",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        hasPrf: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    const account = await signUp(page, sql);
    await context.addCookies(account.cookies);
    const workspaceId = await createWorkspaceMembership(sql, account.userId);
    await page.goto(`${webOrigin}/worker-diagnostics?workspaceId=${workspaceId}`);
    await unlockAndWaitForReady(page);

    const result = await page.evaluate(async (subjectUserId) => {
      const diagnostics = window.__vultoWorkerDiagnostics;
      if (!diagnostics) throw new Error("Worker diagnostics API is unavailable");
      return diagnostics.runProtectedDocumentProof(subjectUserId);
    }, account.userId);

    expect(result.readerSetId).toMatch(/^[a-f0-9]{64}$/);
    expect(result.canonicalHeader).toContain('"formatVersion":1');
    expect(result.canonicalHeader).toContain(
      '"readerSetId":"' + result.readerSetId + '"',
    );
    expect(result.canonicalHeader).toContain('"erasureDomainId":"employee-1"');
    expect(result.tier1RoundTrip).toBe(true);
    expect(result.tier1SharedVectorMatches).toBe(true);
    expect(result.stage3PartitionsAfterReopen).toBe(2);
    expect(result.stage3EpochAfterReopen).toBe(1);
    expect(result.stage3RemovedReaderDenied).toBe(true);
    expect(result.stage3OldKeyDenied).toBe(true);
    expect(result.stage3DocumentBUnaffected).toBe(true);
    expect(result.stage3WorkspaceUnaffected).toBe(true);
    expect(result.stage3WorkspaceDocumentStayedTier02).toBe(true);
    expect(result.stage3AddressMappingRestored).toBe(true);
    expect(result.stage3PostReopenWriteSurvived).toBe(true);
    expect(result.stage3HistoryStayedLazy).toBe(true);
    expect(result.stage3ManifestStayedSealed).toBe(true);
    expect(result.stage3UnauthorizedOnlyMaterializationDenied).toBe(true);
    expect(result.stage3UnauthorizedOnlyOpenDenied).toBe(true);
    expect(result.stage3WrongWorkspaceDenied).toBe(true);
    expect(result.stage6ImmediateReaderGrant).toBe(true);
    expect(result.stage6RetentionLifecycle).toBe(true);
    expect(result.stage6CryptographicErasure).toBe(true);
    expect(result.stage6IntegratedColdReopen).toBe(true);
    expect(result.tier3EnrollmentSubjectOnly).toBe(true);
    expect(result.tier3PrfPersistentReopen).toBe(true);
    expect(result.tier3MandatoryRecoveryConfirmed).toBe(true);
    expect(result.tier3RecoverySubjectOnly).toBe(true);
    expect(result.tier3WrongRecoveryCodeDenied).toBe(true);
    expect(result.tier3OldRecoveryPathDenied).toBe(true);
    expect(result.tier3RetiredCredentialDenied).toBe(true);
    expect(result.tier3PostRecoveryEpoch).toBe(1);
    expect(result.tier3PostRecoveryWriteSurvived).toBe(true);
    expect(result.tier3UnrelatedDocumentSurvived).toBe(true);
    expect(result.tier3WorkspaceStateSurvived).toBe(true);
    expect(result.tier3GenerationHistoryValidated).toBe(true);
    expect(result.tier3RootRotated).toBe(true);
    expect(result.tier3KeysStayedWorkerPrivate).toBe(true);
    expect(result.tier3WindowCeremonyBuffersDetached).toBe(true);

    const durabilityWorkspaceId = await createWorkspaceMembership(sql, account.userId);
    const durability = await page.evaluate(
      async ({ subjectUserId, workspaceId }) => {
        const diagnostics = window.__vultoWorkerDiagnostics;
        if (!diagnostics) throw new Error("Worker diagnostics API is unavailable");
        return diagnostics.runAdversarialDurabilityProof(subjectUserId, workspaceId);
      },
      { subjectUserId: account.userId, workspaceId: durabilityWorkspaceId },
    );
    expect(durability.createdPartitions).toBe(1);
    expect(durability.privateKeyExtractable).toBe(false);
    expect(durability.durableManifestPresentAfterTermination).toBe(true);
    expect(durability.materializedPartitionsAfterTermination).toBe(1);
    expect(durability.identityRestoredAfterTermination).toBe(true);
    expect(durability.restoredPrivateKeyExtractable).toBe(false);
    expect(durability.failedPersistRejected).toBe(true);
    expect(durability.failedPersistMutatedMemory).toBe(false);
    expect(durability.failedPersistLeftDurableStateUnchanged).toBe(true);
    expect(durability.concurrentWritesBothSucceeded).toBe(false);
    expect(durability.concurrentExactlyOneSucceeded).toBe(true);
    expect(durability.generationAfterTwoConcurrentWrites).toBe(2);
    expect(durability.coldRollbackAcceptedAfterWorkerRestart).toBe(true);

    const faultWorkspaceId = await createWorkspaceMembership(sql, account.userId);
    const faults = await page.evaluate(
      async ({ workspaceId, subjectUserId }) =>
        window.__vultoWorkerDiagnostics!.runFailedSecurityTransitionProof(
          workspaceId,
          subjectUserId,
        ),
      { workspaceId: faultWorkspaceId, subjectUserId: account.userId },
    );
    expect(faults).toMatchObject({
      removalRejected: true,
      removalPreservedLive: true,
      grantRejected: true,
      grantPreservedLive: true,
      erasureRejected: true,
      erasurePreservedLive: true,
      tier1DurablePreserved: true,
      recoveryRejected: true,
      recoveryPreservedOldDurable: true,
      tier3ErasureRejected: true,
      tier3ErasurePreservedLive: true,
      tier3ErasureDurablePreserved: true,
    });

    const raceWorkspaces = (await Promise.all([
      createWorkspaceMembership(sql, account.userId),
      createWorkspaceMembership(sql, account.userId),
      createWorkspaceMembership(sql, account.userId),
    ])) as [string, string, string];
    const races = await page.evaluate(
      async ({ workspaceIds, subjectUserId }) =>
        window.__vultoWorkerDiagnostics!.runConcurrentSecurityRaceProof(
          workspaceIds,
          subjectUserId,
        ),
      { workspaceIds: raceWorkspaces, subjectUserId: account.userId },
    );
    expect(races).toMatchObject({
      writeVsRemoval: {
        exactlyOneSucceeded: true,
        preCommitTerminationPreserved: true,
        partitionCount: 1,
      },
      grantVsRemoval: {
        exactlyOneSucceeded: true,
        preCommitTerminationPreserved: true,
        partitionCount: 1,
      },
      twoTier3Recoveries: {
        exactlyOneSucceeded: true,
        preCommitTerminationPreserved: true,
        generation: 1,
        documents: 1,
      },
    });

    const transferId = crypto.randomUUID();
    const source = await page.evaluate(
      async ({ workspaceId, subjectUserId }) =>
        window.__vultoWorkerDiagnostics!.prepareIdentityTransferSource(
          workspaceId,
          subjectUserId,
        ),
      { workspaceId: durabilityWorkspaceId, subjectUserId: account.userId },
    );
    const targetContext = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      await targetContext.addCookies(account.cookies);
      const targetPage = await targetContext.newPage();
      await targetPage.goto(
        `${webOrigin}/worker-diagnostics?workspaceId=${durabilityWorkspaceId}`,
      );
      await unlockAndWaitForReady(targetPage);
      const target = await targetPage.evaluate(
        async ({ workspaceId, subjectUserId, sourceDeviceId, transferId }) =>
          window.__vultoWorkerDiagnostics!.prepareIdentityTransferTarget(
            workspaceId,
            subjectUserId,
            sourceDeviceId,
            transferId,
          ),
        {
          workspaceId: durabilityWorkspaceId,
          subjectUserId: account.userId,
          sourceDeviceId: source.deviceId,
          transferId,
        },
      );
      expect(target.targetDeviceId).not.toBe(source.deviceId);
      const transfer = await page.evaluate(
        async ({ sessionId, common, target, transferId }) =>
          window.__vultoWorkerDiagnostics!.createIdentityTransfer(sessionId, {
            ...common,
            type: "create-transfer",
            targetDeviceId: target.targetDeviceId,
            targetTransferPublicKey: target.targetTransferPublicKey,
            transferId,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        {
          sessionId: source.sessionId,
          common: {
            workspaceId: durabilityWorkspaceId,
            apiOrigin: "https://localhost:3121",
            subjectUserId: account.userId,
          },
          target,
          transferId,
        },
      );
      const accepted = await targetPage.evaluate(
        async ({ sessionId, common, transferId, transfer }) =>
          window.__vultoWorkerDiagnostics!.acceptIdentityTransfer(sessionId, {
            ...common,
            type: "accept-transfer",
            transferId,
            now: new Date().toISOString(),
            payload: transfer.payload,
            challenge: transfer.challenge,
            expectedDocumentKey: transfer.expectedDocumentKey,
          }),
        {
          sessionId: target.sessionId,
          common: {
            workspaceId: durabilityWorkspaceId,
            apiOrigin: "https://localhost:3121",
            subjectUserId: account.userId,
          },
          transferId,
          transfer,
        },
      );
      expect(accepted.challengeOpened).toBe(true);
      expect(accepted.replayDenied).toBe(true);
      expect(accepted.privateKeyExtractable).toBe(false);
    } finally {
      await targetContext.close();
    }
  } finally {
    await sql.end();
  }
});
