import { describe, it, expect } from "vitest";
import { numberToWordsIndian, rupeesInWords } from "../src/domain/words.js";

describe("numberToWordsIndian", () => {
  it("handles zero and small numbers", () => {
    expect(numberToWordsIndian(0)).toBe("Zero");
    expect(numberToWordsIndian(7)).toBe("Seven");
    expect(numberToWordsIndian(19)).toBe("Nineteen");
    expect(numberToWordsIndian(20)).toBe("Twenty");
    expect(numberToWordsIndian(454)).toBe("Four Hundred Fifty Four");
  });

  it("uses the Indian lakh/crore grouping", () => {
    expect(numberToWordsIndian(100000)).toBe("One Lakh");
    expect(numberToWordsIndian(1000000)).toBe("Ten Lakh");
    expect(numberToWordsIndian(12345678)).toBe(
      "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight",
    );
  });
});

describe("rupeesInWords", () => {
  it("formats a whole-rupee paise amount as an invoice amount-in-words", () => {
    expect(rupeesInWords(45400)).toBe("Rupees Four Hundred Fifty Four Only");
    expect(rupeesInWords(0)).toBe("Rupees Zero Only");
  });
});
