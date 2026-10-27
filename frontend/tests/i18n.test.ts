import { describe, expect, it } from "vitest";
import { formatDistanceToNow } from "date-fns";
import {
  getTranslation,
  isLocale,
  locales,
  type Locale,
  type TranslationKey,
} from "../src/i18n";
import { dateFnsLocaleFor } from "../src/i18n/dateLocale";
import en from "../src/i18n/en";
import ptBR from "../src/i18n/pt-BR";
import es from "../src/i18n/es";
import ko from "../src/i18n/ko";

// ─── isLocale() ──────────────────────────────────────────────────────────

describe("isLocale", () => {
  it("accepts valid locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("ko")).toBe(true);
  });

  it("rejects invalid strings", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale("EN")).toBe(false);
    expect(isLocale("pt-br")).toBe(false);
  });

  it("rejects prototype chain properties", () => {
    expect(isLocale("toString")).toBe(false);
    expect(isLocale("__proto__")).toBe(false);
    expect(isLocale("constructor")).toBe(false);
    expect(isLocale("hasOwnProperty")).toBe(false);
  });
});

// ─── getTranslation() ────────────────────────────────────────────────────

describe("getTranslation", () => {
  const tEn = getTranslation("en");
  const tPtBR = getTranslation("pt-BR");
  const tEs = getTranslation("es");

  describe("basic translation", () => {
    it("returns values from the correct locale dictionary", () => {
      // Compare against imported dicts — NOT hardcoded strings
      expect(tEn("header.settings")).toBe(en["header.settings"]);
      expect(tPtBR("header.settings")).toBe(ptBR["header.settings"]);
      expect(tEs("header.settings")).toBe(es["header.settings"]);
    });

    it("returns different values for different locales", () => {
      // Verify translations are actually different
      expect(tPtBR("modal.close")).not.toBe(tEn("modal.close"));
      expect(tEs("modal.close")).not.toBe(tEn("modal.close"));
    });
  });

  describe("interpolation", () => {
    it("replaces named parameters", () => {
      const result = tEn("agentStatus.inQueue", {
        queueType: "render",
        position: 3,
      });
      expect(result).toContain("render");
      expect(result).toContain("3");
      expect(result).not.toContain("{queueType}");
      expect(result).not.toContain("{position}");
    });

    it("works with translated locales", () => {
      const result = tPtBR("agentStatus.inQueue", {
        queueType: "render",
        position: 1,
      });
      expect(result).toContain("render");
      expect(result).toContain("1");
      expect(result).not.toContain("{queueType}");
    });

    it("handles numeric zero as parameter", () => {
      const result = tEn("agentStatus.inQueue", {
        queueType: "task",
        position: 0,
      });
      expect(result).toContain("0");
    });

    it("replaces with empty string when param value is empty", () => {
      const result = tEn("agentStatus.inQueue", {
        queueType: "",
        position: 1,
      });
      // Should not contain the placeholder, should contain the empty replacement
      expect(result).not.toContain("{queueType}");
      expect(result).toContain("1");
    });

    it("leaves unreplaced placeholders intact when param is missing", () => {
      const result = tEn("agentStatus.inQueue", { queueType: "render" });
      expect(result).toContain("render");
      expect(result).toContain("{position}");
    });

    it("ignores extra params with no matching placeholder", () => {
      const result = tEn("header.settings", { unused: "value", another: 42 });
      expect(result).toBe(en["header.settings"]);
    });

    it("leaves text unchanged when empty params object provided", () => {
      expect(tEn("header.settings", {})).toBe(tEn("header.settings"));
    });

    it("escapes regex metacharacters in param keys", () => {
      expect(() =>
        tEn("header.settings", { "key.with+special$chars": "val" }),
      ).not.toThrow();
    });

    it("does not expand $-sequences in replacement values", () => {
      const result = tEn("agentStatus.inQueue", {
        queueType: "$&exploit",
        position: 1,
      });
      expect(result).toContain("$&exploit");
    });
  });

  describe("fallback chain", () => {
    it("returns raw key string when key missing from all dicts", () => {
      const t = getTranslation("en");
      const result = (t as (key: string) => string)("nonexistent.key.xyz");
      expect(result).toBe("nonexistent.key.xyz");
    });

    it("falls back to EN for invalid locale at runtime", () => {
      const t = (getTranslation as (locale: string) => (key: string) => string)(
        "fr",
      );
      expect(t("header.settings")).toBe(en["header.settings"]);
    });
  });

  describe("dictionary parity", () => {
    const enKeys = Object.keys(en).sort();
    const ptBRKeys = Object.keys(ptBR).sort();
    const esKeys = Object.keys(es).sort();
    const koKeys = Object.keys(ko).sort();

    it("PT-BR has exactly the same keys as EN", () => {
      expect(ptBRKeys).toEqual(enKeys);
    });

    it("ES has exactly the same keys as EN", () => {
      expect(esKeys).toEqual(enKeys);
    });

    it("KO has exactly the same keys as EN", () => {
      expect(koKeys).toEqual(enKeys);
    });

    it("KO keeps every {placeholder} of the EN string", () => {
      const placeholders = (text: string) =>
        (text.match(/\{\w+\}/g) ?? []).sort();
      for (const key of enKeys) {
        const k = key as TranslationKey;
        expect(placeholders(ko[k]), `ko["${key}"]`).toEqual(
          placeholders(en[k]),
        );
      }
    });

    it("no locale has empty string values", () => {
      for (const [key, value] of Object.entries(en)) {
        expect(value, `en["${key}"] is empty`).not.toBe("");
      }
      for (const [key, value] of Object.entries(ptBR)) {
        expect(value, `ptBR["${key}"] is empty`).not.toBe("");
      }
      for (const [key, value] of Object.entries(es)) {
        expect(value, `es["${key}"] is empty`).not.toBe("");
      }
      for (const [key, value] of Object.entries(ko)) {
        expect(value, `ko["${key}"] is empty`).not.toBe("");
      }
    });

    it("all locales return a non-empty string for every key via getTranslation", () => {
      for (const key of enKeys) {
        const ptResult = tPtBR(key as TranslationKey);
        const esResult = tEs(key as TranslationKey);
        expect(ptResult.length, `ptBR t("${key}") is empty`).toBeGreaterThan(0);
        expect(esResult.length, `es t("${key}") is empty`).toBeGreaterThan(0);
      }
    });
  });
});

// ─── dateFnsLocaleFor() ──────────────────────────────────────────────────

describe("dateFnsLocaleFor", () => {
  it("gives every non-English locale a date-fns locale", () => {
    for (const locale of Object.keys(locales) as Locale[]) {
      if (locale === "en") continue;
      expect(dateFnsLocaleFor(locale), locale).toBeDefined();
    }
  });

  it("formats Korean relative times in Korean", () => {
    const text = formatDistanceToNow(new Date(Date.now() - 5 * 60_000), {
      addSuffix: true,
      locale: dateFnsLocaleFor("ko"),
    });
    expect(text).toBe("5분 전");
  });

  it("leaves English on the date-fns default", () => {
    expect(dateFnsLocaleFor("en")).toBeUndefined();
  });
});
