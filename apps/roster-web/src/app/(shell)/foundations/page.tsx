import {
  Avatar,
  Badge,
  Button,
  Card,
  Content,
  InlineAlert,
  PageHeader,
  Section,
  Skeleton,
  Stat,
  Text,
} from "@vulto/ui";
import { TYPE_TOKENS } from "@vulto/tokens";
import { CandidateStrip } from "../../../components/CandidateStrip";

/*
 * The token proof sheet.
 *
 * VPS-002: "A 14px base with 32px rows is either obviously right or obviously
 * wrong within thirty seconds of looking at it." This page exists so those
 * thirty seconds happen before anything is built on top of the tokens.
 *
 * It is prototype furniture, not a product screen.
 */

const SURFACE_TOKENS: { name: string; className: string; light: string; dark: string }[] = [
  { name: "bg-canvas", className: "bg-bg-canvas", light: "neutral-50", dark: "neutral-950" },
  { name: "bg-surface", className: "bg-bg-surface", light: "neutral-0", dark: "neutral-900" },
  { name: "bg-raised", className: "bg-bg-raised", light: "neutral-0", dark: "neutral-800" },
  { name: "bg-subtle", className: "bg-bg-subtle", light: "neutral-100", dark: "neutral-800" },
  { name: "bg-hover", className: "bg-bg-hover", light: "neutral-100", dark: "neutral-800" },
  { name: "bg-selected", className: "bg-bg-selected", light: "brand-50", dark: "brand-900" },
  { name: "bg-active", className: "bg-bg-active", light: "neutral-200", dark: "neutral-800" },
];

const NEUTRAL = [
  "bg-neutral-0",
  "bg-neutral-50",
  "bg-neutral-100",
  "bg-neutral-200",
  "bg-neutral-300",
  "bg-neutral-400",
  "bg-neutral-500",
  "bg-neutral-600",
  "bg-neutral-700",
  "bg-neutral-800",
  "bg-neutral-900",
  "bg-neutral-950",
];

const BRAND = [
  "bg-brand-50",
  "bg-brand-100",
  "bg-brand-200",
  "bg-brand-300",
  "bg-brand-400",
  "bg-brand-500",
  "bg-brand-600",
  "bg-brand-700",
  "bg-brand-800",
  "bg-brand-900",
];

const CATEGORICAL = [
  "bg-cat-1",
  "bg-cat-2",
  "bg-cat-3",
  "bg-cat-4",
  "bg-cat-5",
  "bg-cat-6",
  "bg-cat-7",
  "bg-cat-8",
];

const SPACE: { token: string; px: number; className: string }[] = [
  { token: "1", px: 4, className: "w-1" },
  { token: "2", px: 8, className: "w-2" },
  { token: "3", px: 12, className: "w-3" },
  { token: "4", px: 16, className: "w-4" },
  { token: "5", px: 20, className: "w-5" },
  { token: "6", px: 24, className: "w-6" },
  { token: "8", px: 32, className: "w-8" },
  { token: "10", px: 40, className: "w-10" },
  { token: "12", px: 48, className: "w-12" },
  { token: "16", px: 64, className: "w-16" },
  { token: "20", px: 80, className: "w-20" },
];

const TYPE_SPEC: Record<string, string> = {
  display: "32 / 40 · Inter 640 · −0.022em",
  h1: "24 / 30 · Inter 640 · −0.02em",
  h2: "20 / 26 · Inter 600 · −0.015em",
  h3: "16 / 22 · Inter 600",
  body: "14 / 20 · Inter 400",
  "body-medium": "14 / 20 · Inter 500",
  small: "13 / 18 · Inter 400",
  label: "12 / 16 · Inter 500",
  micro: "11 / 14 · Inter 560 · +0.04em",
  numeric: "13 / 18 · Inter 400 · tabular figures",
  "numeric-medium": "13 / 18 · Inter 500 · tabular figures",
  "numeric-md": "16 / 22 · Inter 500 · tabular figures",
  "numeric-lg": "20 / 26 · Inter 600 · tabular figures",
};

const SAMPLE: Record<string, string> = {
  numeric: "£4,200 · 12 days · 76%",
  "numeric-medium": "£4,200",
  "numeric-md": "76%",
  "numeric-lg": "£18,400",
};

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className={`h-10 rounded-md border border-border-default ${className}`}
      />
      <Text variant="micro" className="text-text-tertiary">
        {label}
      </Text>
    </div>
  );
}

export default function FoundationsPage() {
  return (
    <>
      <PageHeader
        title="Foundations"
        subtitle="VPS-D001 rendered. Toggle theme and density at the sidebar foot."
      />
      <Content>
        <Section title="Candidates to choose from">
          <Text variant="small" className="mb-4 text-text-secondary">
            FDN-20. Switch between them at the sidebar foot to see each one
            across the whole Forecast. A palette is judged as a field, not as a
            row of chips: what matters is whether fifteen rows stay
            distinguishable from each other and stay subordinate to the amber.
            The amber bars are included for exactly that reason.
          </Text>
          <CandidateStrip />
        </Section>

        <Section title="Type scale">
          <Text variant="small" className="mb-4 text-text-secondary">
            FDN-29. Inter Variable carries the whole product. Figures use its
            tabular numeral feature for alignment without changing typeface.
            Line heights remain derived against Inter&rsquo;s 1.21em content box,
            which moved exactly one of them —{" "}
            <code className="font-ui text-numeric">display</code>, from 36 to 40.
            Tracking derived from Inter&rsquo;s own metric curve and applied
            above 20px only.
          </Text>
          <div className="flex flex-col gap-4">
            {TYPE_TOKENS.map((token) => (
              <div
                key={token}
                className="flex flex-col gap-1 border-b border-border-default pb-4"
              >
                <div className="flex items-baseline gap-3">
                  <Text variant="micro" className="w-20 shrink-0 text-text-tertiary">
                    {token}
                  </Text>
                  <Text variant="small" className="text-text-tertiary">
                    {TYPE_SPEC[token]}
                  </Text>
                </div>
                <Text variant={token} className="text-text-primary">
                  {SAMPLE[token] ?? "Every gap between bars is bench time"}
                </Text>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Semantic surfaces">
          <div className="grid grid-cols-3 gap-4 xl:grid-cols-6">
            {SURFACE_TOKENS.map((token) => (
              <div key={token.name} className="flex flex-col gap-1">
                <div
                  className={`h-16 rounded-md border border-border-default ${token.className}`}
                />
                <Text variant="micro" className="text-text-tertiary">
                  {token.name}
                </Text>
                <Text variant="small" className="text-text-tertiary">
                  {token.light} / {token.dark}
                </Text>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <InlineAlert tone="attention">
              Finding F10 — in dark mode <code className="font-ui text-numeric">bg-raised</code>,{" "}
              <code className="font-ui text-numeric">bg-subtle</code> and{" "}
              <code className="font-ui text-numeric">bg-hover</code> are all
              neutral-800. Switch to Dark and compare the three swatches above:
              hover is invisible inside any overlay surface.
            </InlineAlert>
          </div>
        </Section>

        <Section title="Text on surface">
          <div className="flex flex-col gap-2 rounded-md border border-border-default bg-bg-surface p-4">
            <Text variant="body" className="text-text-primary">
              text-primary — the default. Body copy at 14px.
            </Text>
            <Text variant="body" className="text-text-secondary">
              text-secondary — supporting copy, roles, subtitles.
            </Text>
            <Text variant="body" className="text-text-tertiary">
              text-tertiary — non-essential only, per VPS-D001.
            </Text>
            <Text variant="micro" className="text-text-tertiary">
              MICRO IN TEXT-TERTIARY — THIS IS WHAT VPS-D002 SPECIFIES FOR EVERY
              TABLE COLUMN HEADER
            </Text>
            <Text variant="body" className="text-text-brand">
              text-brand — rationed to three things.
            </Text>
          </div>
          <div className="mt-4">
            <InlineAlert tone="attention">
              Finding F9 — the micro line above is a table column header as
              specified. It computes to about 2.6:1 in light and 3.7:1 in dark,
              against VPS-D001&rsquo;s 4.5:1 floor, and a column header is the
              sole carrier of what its column means.
            </InlineAlert>
          </div>
        </Section>

        <Section title="Neutral ramp">
          <div className="grid grid-cols-6 gap-2 xl:grid-cols-12">
            {NEUTRAL.map((className) => (
              <Swatch
                key={className}
                className={className}
                label={className.replace("bg-neutral-", "")}
              />
            ))}
          </div>
        </Section>

        <Section title="Brand ramp">
          <div className="grid grid-cols-5 gap-2 xl:grid-cols-10">
            {BRAND.map((className) => (
              <Swatch
                key={className}
                className={className}
                label={className.replace("bg-brand-", "")}
              />
            ))}
          </div>
        </Section>

        <Section title="Semantic hues">
          <div className="grid grid-cols-3 gap-4">
            <Swatch className="bg-success" label="success" />
            <Swatch className="bg-attention" label="attention" />
            <Swatch className="bg-danger" label="danger" />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Text variant="small" className="text-text-secondary">
              attention is the most important token in this product and the
              reason the palette is otherwise starved. It still marks badges,
              alerts and over-target states. The bench region no longer
              composites it at a percentage — see the candidates above.
            </Text>
          </div>
        </Section>

        <Section title="Categorical">
          <div className="grid grid-cols-4 gap-2 xl:grid-cols-8">
            {CATEGORICAL.map((className) => (
              <Swatch
                key={className}
                className={className}
                label={className.replace("bg-", "")}
              />
            ))}
          </div>
        </Section>

        <Section title="Space">
          <div className="flex flex-col gap-2">
            {SPACE.map((item) => (
              <div key={item.token} className="flex items-center gap-3">
                <Text variant="micro" className="w-10 shrink-0 text-text-tertiary">
                  {item.token}
                </Text>
                <Text variant="numeric" className="w-12 shrink-0 text-text-tertiary">
                  {item.px}px
                </Text>
                <div className={`h-2 rounded-sm bg-brand-500 ${item.className}`} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Radius and elevation">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <div className="flex flex-col gap-1">
              <div className="h-16 rounded-sm border border-border-default bg-bg-surface" />
              <Text variant="micro" className="text-text-tertiary">radius-sm · 4px</Text>
            </div>
            <div className="flex flex-col gap-1">
              <div className="h-16 rounded-md border border-border-default bg-bg-surface" />
              <Text variant="micro" className="text-text-tertiary">radius-md · 6px</Text>
            </div>
            <div className="flex flex-col gap-1">
              <div className="h-16 rounded-lg border border-border-default bg-bg-surface" />
              <Text variant="micro" className="text-text-tertiary">radius-lg · 8px</Text>
            </div>
            <div className="flex flex-col gap-1">
              <div className="size-16 rounded-full border border-border-default bg-bg-surface" />
              <Text variant="micro" className="text-text-tertiary">radius-full</Text>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <div className="h-16 rounded-md" />
              <Text variant="micro" className="text-text-tertiary">flat</Text>
            </div>
            <div className="flex flex-col gap-1">
              <div className="elevation-raised h-16 rounded-md" />
              <Text variant="micro" className="text-text-tertiary">raised</Text>
            </div>
            <div className="flex flex-col gap-1">
              <div className="elevation-overlay h-16 rounded-lg" />
              <Text variant="micro" className="text-text-tertiary">overlay</Text>
            </div>
          </div>
        </Section>

        <Section title="Density">
          <Text variant="small" className="mb-4 text-text-secondary">
            The bars below are sized from the density tokens. Toggle Compact and
            Comfortable at the sidebar foot and watch them change — nothing here
            branches on density.
          </Text>
          <div className="flex flex-col gap-4">
            <div>
              <Text variant="micro" className="text-text-tertiary">Table row · 32 / 40</Text>
              <div className="mt-1 flex flex-col rounded-md border border-border-default bg-bg-surface">
                {["Priya Sharma", "Omar Farooq", "Hannah Weiss"].map((name) => (
                  <div
                    key={name}
                    className="flex h-row items-center px-cell hover:bg-bg-hover"
                  >
                    <Text variant="body-medium" className="text-text-primary">{name}</Text>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Text variant="micro" className="text-text-tertiary">Bench Forecast row · 36 / 44</Text>
              <div className="mt-1 flex flex-col rounded-md border border-border-default bg-bg-surface">
                {["Priya Sharma", "Omar Farooq"].map((name) => (
                  <div key={name} className="flex h-timeline-row items-center px-cell">
                    <Text variant="body-medium" className="w-20 shrink-0 text-text-primary">{name}</Text>
                    <div className="h-bar flex-1 rounded-md bg-cat-1" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Text variant="micro" className="text-text-tertiary">Control height · 28 / 32</Text>
              <div className="mt-1 flex gap-2">
                <Button variant="secondary">Assign</Button>
                <Button variant="primary">Approve</Button>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Components">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">Assign</Button>
              <Button variant="secondary">Create an assignment</Button>
              <Button variant="ghost">Filters</Button>
              <Button variant="danger">Cancel assignment</Button>
              <Button variant="danger" confirming>Cancel assignment</Button>
              <Button variant="secondary" disabled>Send for signature</Button>
              <Button variant="primary" loading>Approve</Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">Approved</Badge>
              <Badge tone="attention">On bench</Badge>
              <Badge tone="danger">Rejected</Badge>
              <Badge tone="neutral">Full time</Badge>
              <Badge tone="neutral" dashed>Ghost</Badge>
              <Badge tone="neutral" intensity="solid">7</Badge>
              <Badge tone="attention" intensity="solid">3</Badge>
            </div>

            <div className="flex items-end gap-3">
              <Avatar name="Priya Sharma" size="sm" />
              <Avatar name="Priya Sharma" size="md" />
              <Avatar name="Priya Sharma" size="lg" />
              <Avatar name="Priya Sharma" size="xl" />
              <Avatar name="Senior Backend" size="lg" dashed />
            </div>

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <Card title="Utilization">
                <Stat label="Across 15 people" value="76%" denominator="15 people" />
              </Card>
              <Card title="Bench cost">
                <Stat
                  label="Next 90 days"
                  value="£42,800"
                  scale="numeric-lg"
                  delta={{ text: "+£6,200 vs last week", tone: "attention" }}
                />
              </Card>
              <Card title="Suppressed">
                <Stat
                  label="Design team"
                  value="—"
                  suppressedReason="Not enough people to show this without identifying someone."
                />
              </Card>
              <Card title="Syncing">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </Card>
            </div>

            <div className="flex flex-col gap-2">
              <InlineAlert tone="attention">
                Priya Sharma is committed to 130% between 4 and 18 August.
              </InlineAlert>
              <InlineAlert tone="danger">
                Assignment overlaps an existing commitment.
              </InlineAlert>
              <InlineAlert tone="success">
                Every week in this period has been submitted.
              </InlineAlert>
            </div>
          </div>
        </Section>
      </Content>
    </>
  );
}
