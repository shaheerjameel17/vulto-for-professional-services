import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  applyMutation,
  admitWorkspaceMember,
  deliverNotification,
  audienceMaterializer,
  eq,
  session,
} from "../../../services/api/src/test/sync-browser-support.js";
import {
  NetworkSwitch,
  createOwnedWorkspace,
  db,
  principalFor,
  signInNewUser,
  webOrigin,
  sql,
} from "./helpers.js";

const network = new NetworkSwitch();
test.beforeAll(() => network.start());
test.afterAll(() => network.stop());
test.beforeEach(() => network.restore());

async function seed(userId: string) {
  const workspaceId = await createOwnedWorkspace(userId);
  const otherId = randomUUID();
  // Existing fixture support creates a real login and membership for the second recipient.
  const { makeWorkspace } =
    await import("../../../services/api/src/test/sync-browser-support.js");
  const otherWorld = await makeWorkspace();
  const otherUserId = otherWorld.people.owner!.userId;
  await admitWorkspaceMember({
    workspaceId,
    membershipId: otherId,
    userId: otherUserId,
    roles: ["team-member"],
    actorUserId: userId,
  });
  const owner = await principalFor(userId, workspaceId);
  async function apply(name: string, args: unknown) {
    const result = await applyMutation(owner, {
      mutation_id: randomUUID(),
      name,
      args,
    });
    expect(result.status, JSON.stringify(result)).toBe("applied");
    return result.result as Record<string, unknown>;
  }
  const entity = await apply("entity.create", {
    name: "Palette Entity",
    jurisdiction: "Global",
    default_currency: "USD",
  });
  const employeeIds: string[] = [];
  for (let i = 0; i < 12; i++) {
    const id = randomUUID();
    employeeIds.push(id);
    await apply("employee.create", {
      employee_id: id,
      entity_id: entity["entity_id"],
      effective_from: new Date().toISOString(),
      fields: {
        employee_code: `UI-${id}`,
        full_name:
          i === 0
            ? "Ada Palette"
            : i === 1
              ? "Other Recipient"
              : `Palette Engineer ${i}`,
        email: `${id}@example.test`,
        job_title: "Engineer",
        employment_type: "FullTime",
        start_date: "2026-01-01",
      },
    });
    if (i < 2)
      await apply("employee.linkUser", {
        employee_id: id,
        user_id: i === 0 ? userId : otherUserId,
        expected_version: 1,
      });
  }
  const skillId = randomUUID();
  await apply("graph.createNode", {
    node: {
      node_id: skillId,
      node_type: "Skill",
      schema_version: 1,
      lifecycle_status: "Active",
      skill_id: skillId,
      name: "TypeScript",
      category: "Engineering",
    },
  });
  await apply("employee.attachSkill", {
    employee_id: employeeIds[0],
    skill_id: skillId,
    proficiency_level: "Expert",
  });
  for (const nodeType of ["Project", "Client"] as const)
    for (let i = 0; i < 3; i++) {
      await apply("graph.createNode", {
        node: {
          node_id: randomUUID(),
          node_type: nodeType,
          schema_version: 1,
          lifecycle_status: "Active",
          name: `${nodeType} Palette ${i}`,
        },
      });
    }
  const today = new Date().toISOString(),
    earlier = new Date(Date.now() - 48 * 3600000).toISOString();
  const messages = [
    "Review your capacity",
    "Review your week",
    "Capacity reviewed",
    "Welcome to the workspace",
    "Previous workspace update",
    "OTHER USER PRIVATE NOTICE",
  ];
  await db.transaction(async (tx) => {
    for (let i = 0; i < messages.length; i++) {
      const result = await deliverNotification(
        tx,
        {
          workspaceId,
          subjectEmployeeId: employeeIds[i === 5 ? 1 : 0]!,
          recipient: "employee-self",
          sourceNodeType: "Employee",
          sourceNodeId: employeeIds[0]!,
          ruleId: "ui-1-browser",
          dedupeKey: randomUUID(),
          category: i < 3 || i === 5 ? "ActionNeeded" : "Informational",
          message: messages[i]!,
        },
        i === 4 ? earlier : today,
      );
      expect(result.delivered).toBe(1);
    }
  });
  const rows = await db.execute(
    sql`select node_id, record from graph_nodes where workspace_id = ${workspaceId} and node_type = 'Notification'`,
  );
  const notificationIds = Object.fromEntries(
    rows.map((row) => [
      String((row["record"] as Record<string, unknown>)["message"]),
      String(row["node_id"]),
    ]),
  );
  await apply("notification.markRead", {
    notification_id: notificationIds["Capacity reviewed"],
  });
  await apply("notification.markRead", {
    notification_id: notificationIds["Previous workspace update"],
  });
  await db.transaction((tx) =>
    audienceMaterializer.recomputeWorkspace(tx, workspaceId),
  );
  return { workspaceId, employeeId: employeeIds[0]!, notificationIds };
}

async function theme(page: Page, value: "Light" | "Dark") {
  await page.getByRole("button", { name: "Open Sync Browser Co menu" }).click();
  await page.getByRole("radio", { name: value, exact: true }).click();
  await page.keyboard.press("Escape");
}
async function capture(page: Page, name: string) {
  const directory = path.resolve("docs/stage-reports/ui-1");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  expect((await stat(file)).size).toBeLessThan(400 * 1024);
}
const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
async function measurePalette(page: Page) {
  const opening: number[] = [],
    queries: number[] = [];
  for (let sample = 0; sample < 20; sample++) {
    opening.push(
      await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const start = performance.now();
            const onFocus = (event: FocusEvent) => {
              if (
                (event.target as HTMLElement)?.getAttribute("aria-label") !== "Search"
              )
                return;
              document.removeEventListener("focusin", onFocus);
              resolve(performance.now() - start);
            };
            document.addEventListener("focusin", onFocus);
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
            );
          }),
      ),
    );
    for (const [text, expected] of [
      ["Ada", "Ada Palette"],
      ["Pro", "Project Palette"],
      ["Cli", "Client Palette"],
    ]) {
      queries.push(
        await page.evaluate(
          ({ text, expected }) =>
            new Promise<number>((resolve) => {
              const input = document.querySelector<HTMLInputElement>(
                '[aria-label="Search"]',
              )!;
              const start = performance.now();
              const observer = new MutationObserver(() => {
                const options = [...document.querySelectorAll('[role="option"]')];
                if (!options.some((option) => option.textContent?.includes(expected)))
                  return;
                observer.disconnect();
                resolve(performance.now() - start);
              });
              observer.observe(document.getElementById("command-palette-results")!, {
                childList: true,
                subtree: true,
                characterData: true,
              });
              Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
              )!.set!.call(input, text);
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }),
          { text: text!, expected: expected! },
        ),
      );
    }
    await page.keyboard.press("Escape");
  }
  return { openingP95: p95(opening), queryP95: p95(queries), opening, queries };
}
const row = (page: Page, message: string) =>
  page.getByRole("article", { name: message, exact: true });

// F348 / FDN-140: remove this single-rule baseline and guard when the token is fixed.
// The auth smoke constant lives in a test-registering spec, so do not import it here.
const KNOWN_DEBT_RULES = ["color-contrast"] as const;
function assertGuardedAxe(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
) {
  expect(
    violations.filter(
      (violation) => !KNOWN_DEBT_RULES.some((id) => id === violation.id),
    ),
  ).toEqual([]);
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const classes =
        node.html.match(/^<[^>]*\bclass=["']([^"']*)["']/)?.[1]?.split(/\s+/) ?? [];
      expect(classes, `Unbaselined contrast debt: ${node.html}`).toContain(
        "text-text-tertiary",
      );
    }
  }
}

async function assertCountAgreement(page: Page, count: number) {
  const needsYou = page
    .locator("main section")
    .filter({ has: page.getByRole("heading", { name: "Needs you", exact: true }) });
  const badge = page.getByRole("button", { name: /Inbox/ });
  await expect
    .poll(async () => ({
      unreadActionRows: await needsYou.locator('article[data-unread="true"]').count(),
      sidebarCount: Number((await badge.textContent())?.match(/\d+/)?.[0] ?? 0),
    }))
    .toEqual({ unreadActionRows: count, sidebarCount: count });
  if (count === 0) await expect(badge).not.toContainText(/\d/);
}

for (const appearance of ["Light", "Dark"] as const) {
  test(`real Inbox and palette: audience, actions, keyboard, offline skills, axe and visuals (${appearance})`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(300000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().includes("net::ERR") &&
        !message.text().includes("Failed to fetch")
      )
        errors.push(message.text());
    });
    const userId = await signInNewUser(context);
    const fixture = await seed(userId);
    await page.goto(`${webOrigin}/inbox`);
    await expect(page.getByText("Synced", { exact: true })).toBeVisible({
      timeout: 90000,
    });
    await expect(row(page, "Review your capacity")).toBeVisible();
    await theme(page, appearance);
    expect(await page.locator("main section h2").allTextContents()).toEqual([
      "Needs you",
      "Today",
      "Earlier",
    ]);
    await expect(page.getByText("OTHER USER PRIVATE NOTICE")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Inbox/ })).toContainText("2");
    await assertCountAgreement(page, 2);
    const inboxViolations = (await new AxeBuilder({ page }).analyze()).violations;
    await testInfo.attach("inbox-axe", {
      body: JSON.stringify(inboxViolations),
      contentType: "application/json",
    });
    await capture(page, `inbox-groups-${appearance.toLowerCase()}`);
    // J moves to the next item, K to the previous, independent of click navigation.
    const items = page.getByRole("article");
    await items.nth(0).focus();
    await expect(items.nth(0)).toHaveClass(/bg-bg-selected/);
    await page.keyboard.press("j");
    await expect(items.nth(1)).toHaveClass(/bg-bg-selected/);
    await expect(items.nth(0)).not.toHaveClass(/bg-bg-selected/);
    await page.keyboard.press("k");
    await expect(items.nth(0)).toHaveClass(/bg-bg-selected/);
    await expect(items.nth(1)).not.toHaveClass(/bg-bg-selected/);
    await row(page, "Review your capacity")
      .getByRole("button", { name: "Mark read" })
      .click();
    await expect(page.getByRole("button", { name: /Inbox/ })).toContainText("1");
    await assertCountAgreement(page, 1);
    await page.reload();
    await expect(row(page, "Review your capacity")).toHaveAttribute(
      "data-unread",
      "false",
    );
    await assertCountAgreement(page, 1);
    await theme(page, appearance);
    // E must both mark a previously unread item read and archive it.
    await row(page, "Welcome to the workspace").focus();
    await expect(row(page, "Welcome to the workspace")).toHaveAttribute(
      "data-unread",
      "true",
    );
    await page.keyboard.press("e");
    await expect(row(page, "Welcome to the workspace")).toHaveCount(0);
    await expect
      .poll(async () => {
        const [stored] = await db.execute(
          sql`select record from graph_nodes where node_id = ${fixture.notificationIds["Welcome to the workspace"]}`,
        );
        const record = stored!["record"] as Record<string, unknown>;
        return {
          read: typeof record["read_at"],
          archived: typeof record["dismissed_at"],
          sameTimestamp:
            record["read_at"] !== null && record["read_at"] === record["dismissed_at"],
        };
      })
      .toEqual({ read: "string", archived: "string", sameTimestamp: true });
    await assertCountAgreement(page, 1);
    await row(page, "Previous workspace update")
      .getByRole("button", { name: "Dismiss" })
      .click();
    await expect(row(page, "Previous workspace update")).toHaveCount(0);
    await page.getByRole("button", { name: "Mark all read", exact: true }).click();
    await expect(page.locator('article[data-unread="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Inbox/ })).not.toContainText(/\d/);
    await assertCountAgreement(page, 0);
    await row(page, "Review your capacity").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/people/${fixture.employeeId}$`));
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(row(page, "Review your capacity")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/people/${fixture.employeeId}$`));
    await page.keyboard.press("g");
    await page.keyboard.press("i");

    await page.keyboard.press("Control+k");
    const search = page.getByRole("combobox", { name: "Search" });
    await search.fill("Palette");
    await expect(
      page.getByRole("option", { name: /Palette Engineer 10/ }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: /Project Palette 0/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Client Palette 0/ })).toBeVisible();
    // Scan the settled surface, not opacity composited mid entrance animation.
    // Performance measurements below still start at the actual opening keystroke.
    await page.locator("[data-command-palette-surface]").evaluate(async (element) => {
      await Promise.all(
        element.getAnimations({ subtree: true }).map((animation) => animation.finished),
      );
    });
    const paletteViolations = (await new AxeBuilder({ page }).analyze()).violations;
    await testInfo.attach("palette-axe", {
      body: JSON.stringify(paletteViolations),
      contentType: "application/json",
    });
    await capture(page, `palette-mixed-${appearance.toLowerCase()}`);
    await search.fill("TypeScript");
    await expect(
      page.getByRole("group", { name: "Skills", exact: true }),
    ).toContainText("Engineering");
    await expect(
      page.getByRole("group", { name: "Skill matches", exact: true }),
    ).toContainText("Ada Palette");
    await capture(page, `palette-skills-${appearance.toLowerCase()}`);
    network.cut();
    await search.fill("TypeScrip");
    await expect(page.locator('[data-state="requires-connection"]')).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Skills", exact: true }),
    ).toContainText("TypeScript");
    await capture(page, `palette-connection-${appearance.toLowerCase()}`);
    network.restore();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("group", { name: "Skill matches", exact: true }),
    ).toContainText("Ada Palette");
    await search.fill("NoSuchPaletteRecord");
    const empty = await page
      .getByText("No matches for “NoSuchPaletteRecord”.", { exact: true })
      .textContent();
    await capture(page, `palette-empty-${appearance.toLowerCase()}`);
    await search.fill("create emp");
    await expect(
      page.getByText("No matches for “create emp”.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await page
          .getByText("No matches for “create emp”.", { exact: true })
          .textContent()
      )?.replace("create emp", "NoSuchPaletteRecord"),
    ).toBe(empty);
    await search.fill("Go to People");
    await expect(page.getByRole("option", { name: /Go to People/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/people$/);
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    const timings = await measurePalette(page);
    await testInfo.attach("palette-timings", {
      body: JSON.stringify(timings),
      contentType: "application/json",
    });
    console.log(`UI-1 ${appearance} timing ${JSON.stringify(timings)}`);
    expect(timings.openingP95).toBeLessThan(50);
    expect(timings.queryP95).toBeLessThan(30);
    const dismissButtons = page.getByRole("button", { name: "Dismiss", exact: true });
    while (await dismissButtons.count()) {
      const before = await dismissButtons.count();
      await dismissButtons.first().click();
      await expect(dismissButtons).toHaveCount(before - 1);
    }
    await expect(
      page.getByText("Nothing needs you right now.", { exact: true }),
    ).toBeVisible();
    await capture(page, `inbox-empty-${appearance.toLowerCase()}`);
    await db.transaction((tx) =>
      deliverNotification(
        tx,
        {
          workspaceId: fixture.workspaceId,
          subjectEmployeeId: fixture.employeeId,
          recipient: "employee-self",
          sourceNodeType: "Employee",
          sourceNodeId: fixture.employeeId,
          ruleId: "ui-1-browser-failure",
          dedupeKey: randomUUID(),
          category: "ActionNeeded",
          message: "Action could not complete",
        },
        new Date().toISOString(),
      ),
    );
    await expect(row(page, "Action could not complete")).toBeVisible();
    const failureId = await row(page, "Action could not complete").getAttribute(
      "data-notification-id",
    );
    // Adversarial fixture: a second active delivered_to edge fails the real
    // recipient scope closed. The pre-existing cache remains the audience
    // snapshot; neither mutation outcome nor cache contents are mocked.
    network.cut();
    const conflictingEdge = randomUUID();
    await db.execute(sql`insert into graph_edges (edge_id, workspace_id, edge_type, from_node_id, to_node_id, effective_from, effective_to, version, is_soft_deleted, created_at, created_by, updated_at, updated_by, record)
      select ${conflictingEdge}::uuid, workspace_id, edge_type, from_node_id, to_node_id, effective_from, effective_to, version, is_soft_deleted, created_at, created_by, updated_at, updated_by,
        jsonb_set(record, '{edge_id}', to_jsonb(${conflictingEdge}::text))
      from graph_edges where from_node_id = ${failureId} and edge_type = 'delivered_to' and effective_to is null`);
    await row(page, "Action could not complete")
      .getByRole("button", { name: "Dismiss" })
      .click();
    network.restore();
    await expect(
      row(page, "Action could not complete").getByText(
        "This item is no longer available",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 90000 });
    await expect(
      row(page, "Action could not complete").getByText("not-found", { exact: true }),
    ).toHaveCount(0);
    await capture(page, `inbox-failure-${appearance.toLowerCase()}`);
    expect(errors).toEqual([]);
    assertGuardedAxe(inboxViolations);
    assertGuardedAxe(paletteViolations);
    await testInfo.attach("fixture-scale", {
      body: "12 employees, 1 skill, 3 projects, 3 clients; 6 notifications across 2 recipients",
      contentType: "text/plain",
    });
  });
}

test("a real skill-match 401 opens Reconnect, not a group connection message", async ({
  page,
  context,
}) => {
  const userId = await signInNewUser(context);
  await seed(userId);
  await page.goto(`${webOrigin}/inbox`);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 90000,
  });
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "Search" });
  await search.fill("TypeScript");
  await expect(
    page.getByRole("group", { name: "Skill matches", exact: true }),
  ).toContainText("Ada Palette");
  // Real revocation, exactly the existing Reconnect suite's mechanism; no response stub.
  await db.delete(session).where(eq(session.userId, userId));
  const refused = page.waitForResponse(
    (response) =>
      response.url().includes("/trpc/skillMatcher.adHocSearch") &&
      response.status() === 401,
  );
  await search.fill("TypeScrip");
  expect((await refused).status()).toBe(401);
  await expect(
    page.getByText(
      "Reconnect to continue. Vulto needs to verify your session before opening your workspace.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.locator('[data-state="requires-connection"]')).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Search" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open Sync Browser Co menu" }),
  ).toHaveCount(0);
});
