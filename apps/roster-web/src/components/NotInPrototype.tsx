import { Content, PageHeader, Text } from "@vulto/ui";

/*
 * Prototype scaffolding, not a product screen.
 *
 * FDN-42 asked these to compose VPS-D004's Empty treatment. They deliberately
 * do not, and the reason is the issue's own acceptance criterion.
 *
 * VPS-D004 defines Empty as "the query succeeded and the answer is none" — it
 * is what a built feature renders on a day it holds no rows. Using it here
 * would make an unbuilt destination look like a working feature with nothing in
 * it today, which is precisely what FDN-42 says must never happen. Empty is
 * also specified as body text with no icon, no centered box and no illustration,
 * so composing it would not have addressed the actual complaint either: that
 * 58% of the navigation renders as an unstyled paragraph.
 *
 * What this needed was a state VPS-D004 does not have, because it is not a
 * product state at all — it says something about the prototype rather than
 * about the data.
 *
 * The treatment is not invented. This design system already has a visual
 * language for "a placeholder standing where something real will be": the
 * dashed treatment, used by VRS-F007's Ghost Resources on the Bench Forecast,
 * by dashed Avatar, and by dashed Badge. A dashed panel is the same statement
 * at the scale of a screen. It reads as deliberate rather than unfinished, it
 * cannot be mistaken for a real surface, and it needs no token that does not
 * already exist.
 */

export function NotInPrototype({ title, step }: { title: string; step: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Content>
        {/* The panel runs the full content width on purpose: a dashed outline
         * around the whole region says "this area is reserved and nothing is
         * in it yet", which a small card in the corner would not. The copy
         * inside keeps a reading measure rather than stretching to match it.
         * Left-aligned, not centered — VPS-D004's house style for a state with
         * nothing in it, which this borrows even though it is not Empty. */}
        <div className="pt-8">
          <div className="rounded-lg border border-dashed border-border-strong px-6 py-10">
            <div className="max-w-palette">
              {/* The scaffolding label leads, in the same `micro` treatment the
               * Bench Forecast uses to mark its prototype viewer control. What
               * this is comes before what it will hold. */}
              <Text variant="micro" className="block text-text-tertiary">
                Not in this prototype
              </Text>
              <Text variant="h3" className="mt-2 block text-text-primary">
                {title}
              </Text>
              <Text variant="body" className="mt-2 block text-text-secondary">
                {step}
              </Text>
              <Text variant="small" className="mt-4 block text-text-tertiary">
                This destination exists so the navigation and its shortcut can be
                reviewed. It is not a feature waiting for data.
              </Text>
            </div>
          </div>
        </div>
      </Content>
    </>
  );
}
