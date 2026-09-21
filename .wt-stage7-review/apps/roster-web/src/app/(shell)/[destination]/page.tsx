import { notFound } from "next/navigation";
import { NotInPrototype } from "../../../components/NotInPrototype";

const DESTINATIONS = {
  hiring: {
    title: "Hiring",
    step: "Recruitment, requisitions, candidates and offers are Post-MVP product surfaces.",
  },
  development: {
    title: "Development",
    step: "Reviews, career paths, goals, skills and training are grouped here in the product.",
  },
  "people-ops": {
    title: "People Ops",
    step: "Onboarding, contracts, documents, assets, policies, compliance and cases are grouped here in the product.",
  },
  leave: {
    title: "Leave",
    step: "Leave requests and policy balances are MVP product surfaces outside this design prototype.",
  },
  expenses: {
    title: "Expenses",
    step: "Submission and approval are Scale product surfaces outside this design prototype.",
  },
  payroll: {
    title: "Payroll",
    step: "Payroll, rates, compensation, tax and payment workflows are grouped here in the product.",
  },
  reports: {
    title: "Reports",
    step: "Capacity, people analytics, intelligence, benchmarks and exports are grouped here in the product.",
  },
} as const;

export default async function Page({
  params,
}: {
  params: Promise<{ destination: string }>;
}) {
  const { destination } = await params;
  const item = DESTINATIONS[destination as keyof typeof DESTINATIONS];

  if (!item) notFound();

  return <NotInPrototype title={item.title} step={item.step} />;
}
