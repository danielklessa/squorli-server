import { describe, expect, it } from "vitest";
import { DiscordImportRequest, ImportPlan, ServerState, discordTemplateCodeOf } from "./index";

describe("discordTemplateCodeOf", () => {
  it("reads the code out of the spellings of a template link", () => {
    expect(discordTemplateCodeOf("https://discord.new/2TffvPucqHkN")).toBe("2TffvPucqHkN");
    expect(discordTemplateCodeOf("discord.new/2TffvPucqHkN")).toBe("2TffvPucqHkN");
    expect(discordTemplateCodeOf("http://www.discord.new/2TffvPucqHkN/")).toBe("2TffvPucqHkN");
    expect(discordTemplateCodeOf("https://discord.com/template/2TffvPucqHkN")).toBe("2TffvPucqHkN");
    expect(discordTemplateCodeOf("https://discord.com/template/2TffvPucqHkN/login")).toBe("2TffvPucqHkN");
    expect(discordTemplateCodeOf("https://ptb.discord.com/template/2TffvPucqHkN?x=1")).toBe("2TffvPucqHkN");
    expect(discordTemplateCodeOf("  2TffvPucqHkN  ")).toBe("2TffvPucqHkN");
  });

  it("refuses everything else", () => {
    expect(discordTemplateCodeOf("")).toBeNull();
    expect(discordTemplateCodeOf("https://discord.gg/abc123")).toBeNull();
    expect(discordTemplateCodeOf("https://discord.com/channels/1/2")).toBeNull();
    expect(discordTemplateCodeOf("https://example.com/template/abc")).toBeNull();
    expect(discordTemplateCodeOf("discord.new/")).toBeNull();
    expect(discordTemplateCodeOf("discord.new/with space")).toBeNull();
    expect(discordTemplateCodeOf("not a code!")).toBeNull();
  });
});

describe("import schemas", () => {
  it("accepts a plan and a request, and the state's optional source list", () => {
    const plan = ImportPlan.parse({
      source: { code: "abc", name: "Gilde", description: null },
      categories: [{ key: "1", name: "Allgemein", existingId: null }],
      channels: [{ key: "2", kind: "voice", name: "Lobby", topic: null, audioBitrate: 64, categoryKey: "1", overwrites: [{ roleKey: "everyone", allow: 0, deny: 128 }], memberOverwrites: 1, private: true, exists: false }],
      roles: [{ key: "3", name: "Mod", color: "#ff0000", permissions: 16, exists: false, blocked: null }],
      afkChannelKey: null,
      dropped: [{ name: "@everyone", kind: "role", reason: "default_role" }],
    });
    expect(plan.channels[0]?.overwrites).toEqual([{ roleKey: "everyone", allow: 0, deny: 128 }]);
    expect(plan.channels[0]?.private).toBe(true);
    // A plan from before channel permissions (no overwrite fields) still parses.
    expect(ImportPlan.parse({ ...plan, channels: [{ key: "3", kind: "text", name: "x", topic: null, audioBitrate: 64, categoryKey: null, exists: false }] }).channels[0]?.overwrites).toEqual([]);
    expect(DiscordImportRequest.parse({ code: "abc", categories: [], channels: ["2"], roles: [] }).afkChannel).toBe(false);
    expect(ServerState.shape.importSources.safeParse(undefined).success).toBe(true);
    expect(ServerState.shape.importSources.safeParse(["discord-template"]).success).toBe(true);
    expect(ServerState.shape.importSources.safeParse(["x"]).success).toBe(false);
  });
});
