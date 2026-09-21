import { validateAnonymityDefinition } from "../anonymity.js";

// F93: this module is intentionally malformed. Importing it simulates a future
// feature adding a third protected node with a broad relationship endpoint.
validateAnonymityDefinition({
  nodes: [
    {
      nodeType: "FutureAnonymousContribution",
      universalFields: "anonymous-contribution",
    },
  ],
  edges: [
    {
      edgeType: "future_broad_relationship",
      fromNodeType: "FutureAnonymousContribution",
      toNodeType: "Any Node",
    },
  ],
  registrations: [
    {
      nodeType: "FutureAnonymousContribution",
      allowedRelationships: [],
    },
  ],
  endpointSets: ["Any Node"],
});
