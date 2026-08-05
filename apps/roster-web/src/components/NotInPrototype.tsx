import { Content, PageHeader, Text } from "@vulto/ui";

/*
 * Prototype furniture, not a product screen.
 *
 * These five destinations exist so navigation and the `G` shortcuts can be
 * exercised. VPS-D004's empty state is deliberately not reused here: an empty
 * state means the query succeeded and the answer is none, which is a different
 * fact from a screen that has not been built.
 */

export function NotInPrototype({
  title,
  step,
}: {
  title: string;
  step: string;
}) {
  return (
    <>
      <PageHeader title={title} />
      <Content>
        <div className="mt-6">
          <Text variant="body" className="text-text-secondary">
            Not built yet. {step}
          </Text>
        </div>
      </Content>
    </>
  );
}
