import { Content, PageHeader, Text } from "@vulto/ui";

/*
 * Prototype furniture, not a product screen.
 *
 * These destinations exist so the durable navigation architecture and `G`
 * shortcuts can be exercised without pretending the out-of-scope features
 * have been built. VPS-D004's empty state is deliberately not reused here: an
 * empty state means the query succeeded and the answer is none, which is a
 * different fact from a screen that is outside this prototype.
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
