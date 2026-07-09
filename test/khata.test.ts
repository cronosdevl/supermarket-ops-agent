import { describe, it, expect, beforeEach } from "vitest";
import { charge, payment, balanceOf, listOutstanding, getCustomerByName } from "../src/db/khata.js";
import { StoreError } from "../src/util/errors.js";
import { resetDb } from "./helpers/db.js";

beforeEach(resetDb);

describe("khata — derived balance", () => {
  it("opens an account on first charge and derives the balance from ledger deltas", () => {
    charge("Suresh", 10000);
    charge("Suresh", 5000);
    payment("Suresh", 3000);
    expect(balanceOf("Suresh").balance).toBe(12000); // 100 + 50 − 30 = ₹120
  });

  it("treats names case- and whitespace-insensitively (same account)", () => {
    charge("Ram  Kumar", 10000);
    payment("ram kumar", 4000);
    expect(balanceOf("RAM KUMAR").balance).toBe(6000);
    // Only one customer row was created.
    expect(getCustomerByName("Ram Kumar")).toBeDefined();
  });
});

describe("khata — guardrails (§7)", () => {
  it("refuses a payment against a customer with no khata", () => {
    expect(() => payment("Ghost", 1000)).toThrow(/No khata/);
  });

  it("refuses a balance query for an unknown customer", () => {
    expect(() => balanceOf("Nobody")).toThrow(/No khata account/);
  });

  it("rejects non-positive amounts", () => {
    expect(() => charge("Suresh", 0)).toThrow(StoreError);
    charge("Suresh", 1000);
    expect(() => payment("Suresh", -50)).toThrow(StoreError);
  });
});

describe("khata — listOutstanding", () => {
  it("lists only non-zero balances, highest first", () => {
    charge("Big", 50000);
    charge("Small", 10000);
    charge("Settled", 5000);
    payment("Settled", 5000); // now zero → excluded

    const out = listOutstanding();
    expect(out.map((d) => d.customer.name)).toEqual(["Big", "Small"]);
    expect(out.find((d) => d.customer.name === "Settled")).toBeUndefined();
  });
});
