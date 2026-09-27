import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { GraphClient } from "../src/sync-client/client.js";
import {
  admitWorkspaceMember,
  applyMutation,
  audienceMaterializer,
  db,
  eq,
  session,
  sql,
} from "../../../services/api/src/test/sync-browser-support.js";
import {
  NetworkSwitch,
  createOwnedWorkspace,
  principalFor,
  signInNewUser,
  webOrigin,
  openHarness,
  mutate,
} from "./helpers.js";

const network = new NetworkSwitch();
test.beforeAll(() => network.start());
test.afterAll(() => network.stop());
test.beforeEach(() => network.restore());

// Identical F348 guarded baseline: no exception beyond tertiary-class contrast debt.
function assertGuardedAxe(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
) {
  expect(violations.filter((violation) => violation.id !== "color-contrast")).toEqual(
    [],
  );
  for (const violation of violations)
    for (const node of violation.nodes) {
      const classes =
        node.html.match(/^<[^>]*\bclass=["']([^"']*)["']/)?.[1]?.split(/\s+/) ?? [];
      expect(classes, `Unbaselined contrast debt: ${node.html}`).toContain(
        "text-text-tertiary",
      );
    }
}
async function capture(page: Page, name: string) {
  const directory = path.resolve("docs/stage-reports/ui-2");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  expect((await stat(file)).size).toBeLessThan(400 * 1024);
}
async function setTheme(page: Page, value: "Light" | "Dark") {
  await page.getByRole("button", { name: /^Open .+ menu$/ }).click();
  await page.getByRole("radio", { name: value, exact: true }).click();
  await page.keyboard.press("Escape");
}
async function edit(page: Page, label: string, value: string) {
  await page
    .getByText(label, { exact: true })
    .locator("..")
    .getByRole("button")
    .first()
    .click();
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Control+Enter");
}
async function seed(ownerId: string, memberId: string, managerId: string) {
  const workspaceId = await createOwnedWorkspace(ownerId);
  for (const [id, role] of [
    [memberId, "team-member"],
    [managerId, "team-member"],
  ] as const) {
    await admitWorkspaceMember({
      workspaceId,
      membershipId: randomUUID(),
      userId: id,
      roles: [role],
      actorUserId: ownerId,
    });
    await db
      .update(session)
      .set({ activeOrganizationId: workspaceId })
      .where(eq(session.userId, id));
  }
  const principal = await principalFor(ownerId, workspaceId);
  async function apply(name: string, args: unknown) {
    const result = await applyMutation(principal, {
      mutation_id: randomUUID(),
      name,
      args,
    });
    expect(result.status, JSON.stringify(result)).toBe("applied");
    return result.result as Record<string, unknown>;
  }
  const entity = await apply("entity.create", {
    name: "People Entity",
    jurisdiction: "Global",
    default_currency: "USD",
  });
  const ids: string[] = [];
  for (let i = 0; i < 150; i++) {
    const id = randomUUID();
    ids.push(id);
    await apply("employee.create", {
      employee_id: id,
      entity_id: entity["entity_id"],
      effective_from: new Date().toISOString(),
      fields: {
        employee_code: `UI2-${i}-${id.slice(0, 8)}`,
        full_name: `Person ${String(i).padStart(2, "0")}`,
        email: `${id}@example.test`,
        job_title: "Engineer",
        employment_type: "FullTime",
        start_date: "2026-01-01",
        department: "Engineering",
      },
    });
  }
  // Manager is graph-derived, not an assignable workspace role.
  await apply("employee.linkUser", {
    employee_id: ids[2],
    user_id: managerId,
    expected_version: 1,
  });
  await apply("org.moveEmployee", {
    employee_id: ids[3],
    new_manager_id: ids[2],
    effective_from: new Date().toISOString(),
  });
  await apply("employee.setCompensation", {
    employee_id: ids[0],
    compensation: {
      base_compensation_amount: 65000,
      compensation_frequency: "Annual",
      compensation_currency: "USD",
    },
  });
  await apply("org.moveEmployee", {
    employee_id: ids[0],
    new_manager_id: ids[1],
    effective_from: new Date().toISOString(),
  });
  const skillId = randomUUID();
  await apply("graph.createNode", {
    node: {
      node_id: skillId,
      node_type: "Skill",
      schema_version: 1,
      lifecycle_status: "Active",
      name: "TypeScript",
      skill_id: skillId,
      category: "Engineering",
    },
  });
  await apply("employee.attachSkill", {
    employee_id: ids[0],
    skill_id: skillId,
    proficiency_level: "Senior",
  });
  await db.transaction((tx) =>
    audienceMaterializer.recomputeWorkspace(tx, workspaceId),
  );
  return { workspaceId, ids, apply, principal };
}

for (const appearance of ["Light", "Dark"] as const) {
  test(`real People and profile: edits, reporting, protected states, order, offline and visuals (${appearance})`, async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const errors: string[] = [];
    const axeViolations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().includes("net::ERR") &&
        !message.text().includes("Failed to fetch")
      )
        errors.push(message.text());
    });
    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const managerContext = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const ownerId = await signInNewUser(context);
      const memberId = await signInNewUser(memberContext);
      const managerId = await signInNewUser(managerContext);
      const fixture = await seed(ownerId, memberId, managerId);
      await page.goto(`${webOrigin}/people`);
      await expect(page.getByText("Synced", { exact: true })).toBeVisible({
        timeout: 90000,
      });
      await expect(page.locator("tbody tr")).toHaveCount(150);
      await page.getByRole("button", { name: "Open Sync Browser Co menu" }).click();
      await page.getByRole("radio", { name: appearance, exact: true }).click();
      await page.keyboard.press("Escape");
      await capture(page, `directory-${appearance.toLowerCase()}`);
      axeViolations.push(...(await new AxeBuilder({ page }).analyze()).violations);
      await page.getByRole("button", { name: /^Employment type:/ }).click();
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.getByRole("checkbox", { name: "Part time", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(
        page.getByText("No one matches these filters.", { exact: true }),
      ).toBeVisible();
      await capture(page, `directory-empty-${appearance.toLowerCase()}`);
      await page.getByRole("button", { name: /^Employment type:/ }).click();
      await page.getByRole("button", { name: "Select all", exact: true }).click();
      await page.keyboard.press("Escape");
      // Sort via the actual Table header; emitted order must match J/K, not UUID order.
      await page.getByRole("button", { name: "Name", exact: true }).click();
      await page.getByText("Person 00", { exact: true }).click();
      await expect(page.getByText("65000", { exact: true })).toBeVisible();
      await capture(page, `profile-available-${appearance.toLowerCase()}`);
      axeViolations.push(...(await new AxeBuilder({ page }).analyze()).violations);
      await edit(page, "Base amount", "70000");
      await expect(page.getByText("70000", { exact: true })).toBeVisible();
      await page.keyboard.press("j");
      await expect(page).toHaveURL(new RegExp(fixture.ids[1]!));
      await page.keyboard.press("k");
      await expect(page).toHaveURL(new RegExp(fixture.ids[0]!));
      await edit(page, "Job title", "Lead Engineer");
      await expect
        .poll(async () => {
          const rows = await db.execute(
            sql`select record from graph_nodes where node_id = ${fixture.ids[0]}`,
          );
          return (rows[0]?.["record"] as Record<string, unknown>)?.["job_title"];
        })
        .toBe("Lead Engineer");
      await edit(page, "Reports to", "Person 02");
      await expect(
        page.getByText("Reports to", { exact: true }).locator(".."),
      ).toContainText("Person 02");
      // Person 02 -> Person 00 would close the just-created cycle.
      await page.goto(`${webOrigin}/people/${fixture.ids[2]}`);
      await edit(page, "Reports to", "Person 00");
      await expect(
        page.getByText(
          "This reporting line would create a cycle. Choose another manager",
        ),
      ).toBeVisible();
      await capture(page, `reporting-cycle-${appearance.toLowerCase()}`);
      await page.goto(`${webOrigin}/people/${fixture.ids[0]}`);
      for (const [tab, expected] of [
        ["Skills", "No certifications on file."],
        ["Documents", "No documents uploaded yet."],
        ["Activity", "Nothing recorded yet."],
      ]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await expect(page.getByText(expected!, { exact: true })).toBeVisible();
        if (tab === "Skills")
          await expect(page.getByText("TypeScript", { exact: true })).toBeVisible();
        axeViolations.push(...(await new AxeBuilder({ page }).analyze()).violations);
        await capture(page, `${tab!.toLowerCase()}-${appearance.toLowerCase()}`);
      }
      const memberPage = await memberContext.newPage();
      const memberAnswer = memberPage.waitForResponse((response) =>
        response.url().includes("employee.get"),
      );
      await memberPage.goto(`${webOrigin}/people/${fixture.ids[0]}`);
      await expect(memberPage.getByText("Person 00", { exact: true })).toBeVisible();
      expect((await memberAnswer).ok()).toBe(true);
      await setTheme(memberPage, appearance);
      await expect(
        memberPage.getByRole("heading", { name: "Compensation", exact: true }),
      ).toHaveCount(0);
      await capture(memberPage, `profile-absent-${appearance.toLowerCase()}`);
      axeViolations.push(
        ...(await new AxeBuilder({ page: memberPage }).analyze()).violations,
      );
      const managerPage = await managerContext.newPage();
      await managerPage.goto(`${webOrigin}/people/${fixture.ids[0]}`);
      await expect(
        managerPage.getByText("Visible to Finance Admin", { exact: true }),
      ).toBeVisible();
      await expect(managerPage.getByText("65000", { exact: true })).toHaveCount(0);
      await setTheme(managerPage, appearance);
      await capture(managerPage, `profile-restricted-${appearance.toLowerCase()}`);
      axeViolations.push(
        ...(await new AxeBuilder({ page: managerPage }).analyze()).violations,
      );
      // Fresh profile tab: no remembered directory order, so use plain local order.
      const fallback = [...fixture.ids].sort();
      const next =
        fallback[Math.min(fallback.length - 1, fallback.indexOf(fixture.ids[0]!) + 1)]!;
      await managerPage.keyboard.press("j");
      await expect(managerPage).toHaveURL(new RegExp(next));
      const harness = await context.newPage();
      await openHarness(harness, fixture.workspaceId, ownerId);
      const snapshot = await harness.evaluate(async (employeeId) => {
        const client = (window as unknown as { __vultoSync: { client: GraphClient } })
          .__vultoSync.client;
        const query = {
          kind: "device-query",
          name: "employee.get",
          args: { employee_id: employeeId },
        } as const;
        const { result } = await client.query(query);
        if (
          result.kind !== "device-query" ||
          result.name !== "employee.get" ||
          !result.data
        )
          throw new Error("Employee query missing");
        return result.data;
      }, fixture.ids[0]!);
      expect(
        await mutate(harness, "employee.update", {
          employee_id: fixture.ids[0],
          expected_version: snapshot.version - 1,
          patch: { job_title: "Stale overwrite" },
        }),
      ).toMatchObject({ accepted: false, reason: "stale-state" });
      const dump = await harness.evaluate(() =>
        (
          window as unknown as { __vultoSync: { client: GraphClient } }
        ).__vultoSync.client.dump(),
      );
      expect(JSON.stringify(dump)).not.toContain('"base_compensation_amount":70000');
      await harness.close();
      network.cut();
      await page.goto(`${webOrigin}/people`);
      await expect(page.locator("tbody tr")).toHaveCount(150);
      // Warm-cache directory must keep working during the actual proxy outage.
      await expect(page.getByText("Person 00", { exact: true })).toBeVisible();
      const samples = await page.evaluate(async () => {
        const times: number[] = [];
        for (let sample = 0; sample < 20; sample++) {
          const time = await new Promise<number>((resolve) => {
            const body = document.querySelector("tbody")!;
            const button = [
              ...document.querySelectorAll<HTMLButtonElement>("thead button"),
            ].find((button) => button.textContent?.trim() === "Name")!;
            const start = performance.now();
            const observer = new MutationObserver(() => {
              observer.disconnect();
              resolve(performance.now() - start);
            });
            observer.observe(body, { childList: true, subtree: true });
            button.click();
          });
          times.push(time);
        }
        return times;
      });
      const directoryP95 = [...samples].sort((a, b) => a - b)[18]!;
      expect(directoryP95).toBeLessThan(200);
      console.info(
        `UI-2 offline Table sort/render p95, 150 employees (${appearance}): ${directoryP95.toFixed(2)}ms`,
      );
      network.restore();
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await testInfo.attach("fixture-scale", {
        body: JSON.stringify({ employees: 150, scaleRatio: 1, directoryP95, samples }),
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
      await testInfo.attach("ui-2-axe", {
        body: JSON.stringify(axeViolations),
        contentType: "application/json",
      });
      assertGuardedAxe(axeViolations);
    } finally {
      network.restore();
      await memberContext.close();
      await managerContext.close();
    }
  });
}
