import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addEdge,
  addNode,
  admitWorkspaceMember,
  applyMutation,
  audienceMaterializer,
  db,
  eq,
  getKeyServices,
  session,
  writeProtected,
} from "../../../services/api/src/test/sync-browser-support.js";
import {
  NetworkSwitch,
  createOwnedWorkspace,
  principalFor,
  signInNewUser,
  webOrigin,
} from "./helpers.js";

const network = new NetworkSwitch();
test.beforeAll(() => network.start());
test.afterAll(() => network.stop());
test.beforeEach(() => network.restore());

function shift(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
async function screenshot(page: Page, name: string) {
  const directory = path.resolve("docs/stage-reports/ui-3");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${name}.jpg`);
  await page.screenshot({
    path: file,
    type: "jpeg",
    quality: 78,
    fullPage: true,
    animations: "disabled",
  });
  expect((await stat(file)).size).toBeLessThan(400 * 1024);
}
async function theme(page: Page, value: "Light" | "Dark") {
  await page.getByRole("button", { name: /^Open .+ menu$/ }).click();
  await page.getByRole("radio", { name: value, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", value.toLowerCase());
}
async function guardedAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((item) => item.id !== "color-contrast")).toEqual([]);
  for (const violation of violations)
    for (const node of violation.nodes) {
      const classes =
        node.html.match(/^<[^>]*\bclass=["']([^"']*)["']/)?.[1]?.split(/\s+/) ?? [];
      expect(classes, `Unbaselined contrast debt: ${node.html}`).toContain(
        "text-text-tertiary",
      );
    }
}

async function seed(ownerId: string, managerUserId: string) {
  const workspaceId = await createOwnedWorkspace(ownerId);
  await admitWorkspaceMember({
    workspaceId,
    membershipId: randomUUID(),
    userId: managerUserId,
    roles: ["team-member"],
    actorUserId: ownerId,
  });
  await db
    .update(session)
    .set({ activeOrganizationId: workspaceId })
    .where(eq(session.userId, managerUserId));
  const owner = await principalFor(ownerId, workspaceId);
  async function apply(name: string, args: unknown) {
    const answer = await applyMutation(owner, {
      mutation_id: randomUUID(),
      name,
      args,
    });
    expect(answer.status, JSON.stringify(answer)).toBe("applied");
    return answer.result as Record<string, unknown>;
  }
  const today = new Date().toISOString().slice(0, 10);
  const entity = await apply("entity.create", {
    name: "UAE Studio",
    jurisdiction: "AE",
    default_currency: "AED",
  });
  const entityId = String(entity["entity_id"]);
  const calendarId = String(entity["calendar_id"]);
  await apply("holiday.add", {
    calendar_id: calendarId,
    fields: { name: "Studio Holiday", date: shift(today, 2), holiday_type: "Company" },
  });
  const clientId = randomUUID();
  await apply("graph.createNode", {
    node: {
      node_id: clientId,
      node_type: "Client",
      schema_version: 1,
      lifecycle_status: "Active",
      name: "Acme",
    },
  });
  const projectId = randomUUID();
  await apply("graph.createNode", {
    node: {
      node_id: projectId,
      node_type: "Project",
      schema_version: 1,
      lifecycle_status: "Active",
      name: "Acme Delivery",
    },
  });
  await apply("graph.createEdge", {
    edge: {
      edge_id: randomUUID(),
      edge_type: "belongs_to",
      from_node_id: projectId,
      to_node_id: clientId,
      effective_from: new Date().toISOString(),
      effective_to: null,
    },
  });
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const id = randomUUID();
    ids.push(id);
    await apply("employee.create", {
      employee_id: id,
      entity_id: entityId,
      effective_from: new Date().toISOString(),
      fields: {
        employee_code: `B-${i}-${id.slice(0, 6)}`,
        full_name:
          i === 0 ? "Ada Bench" : i === 1 ? "Ben Manager" : `Bench Person ${i}`,
        email: `${id}@example.test`,
        job_title: "Consultant",
        employment_type: "FullTime",
        start_date: shift(today, -60),
        department: "Delivery",
        seniority_level: "Senior",
      },
    });
  }
  await apply("employee.linkUser", {
    employee_id: ids[1],
    user_id: managerUserId,
    expected_version: 1,
  });
  await apply("org.moveEmployee", {
    employee_id: ids[2],
    new_manager_id: ids[1],
    effective_from: new Date().toISOString(),
  });
  await apply("assignment.create", {
    employee_id: ids[0],
    project_id: projectId,
    start_date: today,
    end_date: shift(today, 3),
    billable_percentage: 100,
  });
  await apply("employee.setCompensation", {
    employee_id: ids[0],
    compensation: {
      base_compensation_amount: 365000,
      compensation_frequency: "Annual",
      compensation_currency: "AED",
    },
  });
  const openRoleId = randomUUID();
  await apply("graph.createNode", {
    node: {
      node_id: openRoleId,
      node_type: "OpenRole",
      schema_version: 1,
      lifecycle_status: "Open",
      name: "Planned Consultant",
    },
  });
  const ghost = await apply("ghostResource.create", {
    role_title: "Planned Consultant",
    projected_start_date: shift(today, 7),
    seniority_level: "Senior",
    open_role_id: openRoleId,
  });
  // Ghost creation does not choose an Entity; the ordinary edge mutation does.
  await apply("graph.createEdge", {
    edge: {
      edge_id: randomUUID(),
      edge_type: "scoped_to_entity",
      from_node_id: ghost["employeeId"],
      to_node_id: entityId,
      effective_from: new Date().toISOString(),
      effective_to: null,
    },
  });
  await db.transaction(async (tx) => {
    const id = await addNode(tx, workspaceId, "BurnoutAlert");
    await addEdge(tx, workspaceId, "triggered_by", id, ids[0]);
    await writeProtected(
      tx,
      getKeyServices(),
      { workspaceId, nodeId: id, nodeType: "BurnoutAlert" },
      "record",
      { severity: "High" },
    );
  });
  await db.transaction((tx) =>
    audienceMaterializer.recomputeWorkspace(tx, workspaceId),
  );
  return { workspaceId, ids, ghostId: String(ghost["employeeId"]), projectId };
}

test("real Bench Forecast: local timeline, protected data, mutations, keyboard and visuals", async ({
  page,
  context,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const managerContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const ownerId = await signInNewUser(context);
    const managerId = await signInNewUser(managerContext);
    const fixture = await seed(ownerId, managerId);
    await page.goto(webOrigin);
    await expect(page.getByText("Synced", { exact: true })).toBeVisible({
      timeout: 90000,
    });
    await expect(page.getByText("Ada Bench", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Planned Consultant", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Acme Delivery", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/AED|د\.إ/).first()).toBeVisible();
    await expect(page.getByText(/Utilization/).first()).toBeVisible();
    await guardedAxe(page);
    for (const appearance of ["Light", "Dark"] as const) {
      await theme(page, appearance);
      for (const [key, horizon] of [
        ["1", "30"],
        ["2", "90"],
        ["3", "180"],
      ] as const) {
        await page.keyboard.press(key);
        await expect(page.getByRole("group", { name: "Horizon" })).toContainText(
          horizon,
        );
        await screenshot(page, `forecast-${horizon}-${appearance.toLowerCase()}`);
      }
    }
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Skills", { exact: true }).first()).toBeVisible();
    await screenshot(page, "employee-panel-light");
    await page.keyboard.press("Escape");
    await page.keyboard.press("f");
    await expect(page.getByRole("region", { name: "Forecast filters" })).toBeVisible();
    await page.keyboard.press("t");
    await page.getByText("Planned Consultant", { exact: true }).first().click();
    await expect(
      page.getByRole("button", { name: "Promote to employee" }),
    ).toBeVisible();
    await screenshot(page, "ghost-panel-light");
    await page.keyboard.press("Escape");
    network.cut();
    await page.keyboard.press("1");
    await expect(page.getByText("Ada Bench", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    network.restore();
    await managerContext.close();
  }
});
