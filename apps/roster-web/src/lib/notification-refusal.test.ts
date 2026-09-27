import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_REFUSAL_MESSAGES,
  notificationRefusalMessage,
} from "./notification-refusal";

describe("Inbox refusal presentation", () => {
  it.each(Object.entries(NOTIFICATION_REFUSAL_MESSAGES))(
    "renders %s as a human sentence",
    (reason, sentence) => {
      expect(notificationRefusalMessage(reason)).toBe(sentence);
      expect(sentence).not.toBe(reason);
    },
  );
  it("uses the generic sentence for unknown codes, including inherited keys", () => {
    for (const code of ["new-server-code", "constructor", "__proto__"])
      expect(notificationRefusalMessage(code)).toBe(
        "That action could not be completed",
      );
  });
});
