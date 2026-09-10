import { describe, expect, it } from "vitest";
import { matchLooseVisitBookingIds } from "./check-in-matching";

describe("matchLooseVisitBookingIds", () => {
  it("does not move a booking-less visit onto an earlier appointment", () => {
    const visits = [{ client_id: "client-1", visit_ymd: "2026-09-09" }];
    const probes = [
      { booking_id: "older", client_id: "client-1", appointment_ymd: "2026-09-08" },
      { booking_id: "same-day", client_id: "client-1", appointment_ymd: "2026-09-09" },
    ];

    expect([...matchLooseVisitBookingIds(probes, visits)]).toEqual(["same-day"]);
  });

  it("returns the same result for a day alone or within a multi-day window", () => {
    const visits = [{ client_id: "client-1", visit_ymd: "2026-09-09" }];
    const day = [
      { booking_id: "same-day", client_id: "client-1", appointment_ymd: "2026-09-09" },
    ];
    const window = [
      { booking_id: "older", client_id: "client-1", appointment_ymd: "2026-09-08" },
      ...day,
    ];

    expect(matchLooseVisitBookingIds(day, visits).has("same-day")).toBe(true);
    expect(matchLooseVisitBookingIds(window, visits).has("same-day")).toBe(true);
  });

  it("uses one booking-less visit for only one same-day appointment", () => {
    const matched = matchLooseVisitBookingIds(
      [
        { booking_id: "first", client_id: "client-1", appointment_ymd: "2026-09-09" },
        { booking_id: "second", client_id: "client-1", appointment_ymd: "2026-09-09" },
      ],
      [{ client_id: "client-1", visit_ymd: "2026-09-09" }],
    );

    expect([...matched]).toEqual(["first"]);
  });
});