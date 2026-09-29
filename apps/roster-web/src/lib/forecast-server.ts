import type { AppRouter } from "@vulto/api";
import { apiOrigin } from "./auth-client";

type Caller = ReturnType<AppRouter["createCaller"]>;
export type AggregateAnswer = Awaited<
  ReturnType<Caller["benchForecast"]["getAggregate"]>
>;
export type CostAnswer = Awaited<ReturnType<Caller["benchForecast"]["getCost"]>>;
export type ProtectedContextAnswer = Awaited<
  ReturnType<Caller["contextualIntelligence"]["getProtected"]>
>;

async function request<T>(
  procedure: string,
  input: unknown,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `${apiOrigin}/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
    { credentials: "include", cache: "no-store", signal },
  );
  if (!response.ok)
    throw Object.assign(new Error(`${procedure} unavailable`), {
      status: response.status,
    });
  const body = (await response.json()) as { result: { data: T } };
  return body.result.data;
}

export const fetchBenchAggregate = (
  input: Parameters<Caller["benchForecast"]["getAggregate"]>[0],
  signal: AbortSignal,
) => request<AggregateAnswer>("benchForecast.getAggregate", input, signal);
export const fetchBenchCosts = (
  input: Parameters<Caller["benchForecast"]["getCost"]>[0],
  signal: AbortSignal,
) => request<CostAnswer>("benchForecast.getCost", input, signal);
export const fetchProtectedContext = (employeeId: string, signal: AbortSignal) =>
  request<ProtectedContextAnswer>(
    "contextualIntelligence.getProtected",
    { employee_id: employeeId },
    signal,
  );
