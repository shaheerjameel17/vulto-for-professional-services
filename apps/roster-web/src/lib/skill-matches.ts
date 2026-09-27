import type { AppRouter } from "@vulto/api";
import { apiOrigin } from "./auth-client";

type Caller = ReturnType<AppRouter["createCaller"]>;
export type SkillMatchAnswer = Awaited<
  ReturnType<Caller["skillMatcher"]["adHocSearch"]>
>;

/** Ordinary authenticated read; local results never wait for this request. */
export async function fetchSkillMatches(
  query: string,
  signal: AbortSignal,
): Promise<SkillMatchAnswer> {
  const input = { query: query.trim(), availability_window_days: 30 };
  const response = await fetch(
    `${apiOrigin}/trpc/skillMatcher.adHocSearch?input=${encodeURIComponent(JSON.stringify(input))}`,
    {
      credentials: "include",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    },
  );
  if (!response.ok)
    throw Object.assign(new Error("Skill matches require a connection"), {
      status: response.status,
    });
  const body = (await response.json()) as { result: { data: SkillMatchAnswer } };
  return body.result.data;
}
