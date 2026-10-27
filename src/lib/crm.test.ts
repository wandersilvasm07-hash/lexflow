import { describe, expect, it } from "vitest";
import { addDays, mondayOf, toCsv, zonedToIso } from "./crm";

describe("datas no fuso do escritório", () => {
  it("converte hora local de Lisboa em inverno e verão", () => {
    expect(zonedToIso("2026-01-15", "10:00", "Europe/Lisbon")).toBe("2026-01-15T10:00:00.000Z");
    expect(zonedToIso("2026-07-15", "10:00", "Europe/Lisbon")).toBe("2026-07-15T09:00:00.000Z");
    expect(zonedToIso("2026-07-15", "10:00", "Atlantic/Azores")).toBe("2026-07-15T10:00:00.000Z");
  });

  it("dias de mudança de hora", () => {
    // 29 de março de 2026: Lisboa passa de UTC+0 para UTC+1 às 01:00.
    expect(zonedToIso("2026-03-29", "09:00", "Europe/Lisbon")).toBe("2026-03-29T08:00:00.000Z");
    // 25 de outubro de 2026: volta a UTC+0.
    expect(zonedToIso("2026-10-25", "09:00", "Europe/Lisbon")).toBe("2026-10-25T09:00:00.000Z");
  });

  it("segunda-feira da semana e soma de dias", () => {
    expect(mondayOf(new Date("2026-10-29T12:00:00Z"), "Europe/Lisbon")).toBe("2026-10-26");
    expect(mondayOf(new Date("2026-11-01T23:30:00Z"), "Europe/Lisbon")).toBe("2026-10-26");
    expect(addDays("2026-10-26", 7)).toBe("2026-11-02");
    expect(addDays("2026-12-29", 5)).toBe("2027-01-03");
  });
});

describe("exportação CSV", () => {
  it("escapa separadores, aspas e neutraliza fórmulas", () => {
    const csv = toCsv([
      ["Nome", "Notas"],
      ["Silva; Ana", 'Disse "olá"'],
      ["=HYPERLINK(\"x\")", "+351910000000"],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe('"Silva; Ana";"Disse ""olá"""');
    expect(lines[2]).toBe("\"'=HYPERLINK(\"\"x\"\")\";'+351910000000");
  });
});
