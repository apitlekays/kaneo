import { describe, expect, it } from "vitest";
import { canReadMeeting } from "../../../apps/api/src/meeting/access";

const base = {
  confidential: false,
  attendeeUserIds: ["u1", "u2"],
  userId: "u3",
  isGlobalAdmin: false,
};

describe("canReadMeeting", () => {
  it("lets any page holder read a non-confidential meeting", () => {
    expect(canReadMeeting(base)).toBe(true);
  });

  it("refuses a non-attendee on a confidential meeting", () => {
    expect(canReadMeeting({ ...base, confidential: true })).toBe(false);
  });

  it("lets an attendee read a confidential meeting", () => {
    expect(canReadMeeting({ ...base, confidential: true, userId: "u1" })).toBe(
      true,
    );
  });

  it("lets a global admin read a confidential meeting they did not attend", () => {
    expect(
      canReadMeeting({ ...base, confidential: true, isGlobalAdmin: true }),
    ).toBe(true);
  });

  it("refuses a non-attendee on a confidential meeting with no attendees at all", () => {
    // A meeting whose attendees have not been recorded yet must not become
    // readable by everyone just because the list is empty.
    expect(
      canReadMeeting({ ...base, confidential: true, attendeeUserIds: [] }),
    ).toBe(false);
  });
});
