import { describe, expect, it } from "vitest";
import { decodeMentions, encodeMentions, mentionQueryAt, mentionedIds, mentionsUser, suggestMembers, type Mentionable } from "./mentions";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const max: Mentionable = { userId: id(1), displayName: "Max", handle: "maxi" };
const maxM: Mentionable = { userId: id(2), displayName: "Max Mustermann", handle: null };
const anna: Mentionable = { userId: id(3), displayName: "@anna", handle: "anna" };
const twin: Mentionable = { userId: id(4), displayName: "Max", handle: null };
const members = [max, maxM, anna];

describe("mentions in message text", () => {
  it("turns names and handles into tokens, the longest name first", () => {
    expect(encodeMentions("Hallo @Max Mustermann und @max, auch @anna!", members)).toBe(`Hallo <@${id(2)}> und <@${id(1)}>, auch <@${id(3)}>!`);
    expect(encodeMentions("@maxi kommt", members)).toBe(`<@${id(1)}> kommt`);
  });
  it("leaves mail addresses, unknown names, longer words and code alone", () => {
    for (const s of ["mail@max.de", "@Maximilian", "@niemand", "`@Max` und ```\n@Max\n```"]) expect(encodeMentions(s, members)).toBe(s);
  });
  it("lets the chosen member decide between equal names", () => {
    expect(encodeMentions("@Max", [max, twin])).toBe(`<@${id(1)}>`);
    expect(encodeMentions("@Max", [max, twin], new Map([["Max", id(4)]]))).toBe(`<@${id(4)}>`);
    expect(encodeMentions("@Max", [max], new Map([["Max", id(4)]]))).toBe(`<@${id(1)}>`);   // the chosen one has left
  });
  it("shows names again for editing and round-trips", () => {
    const content = `Hallo <@${id(2)}> und <@${id(3)}>, nicht <@${id(9)}> und nicht \`<@${id(1)}>\``;
    const { text, picked } = decodeMentions(content, members);
    expect(text).toBe(`Hallo @Max Mustermann und @anna, nicht <@${id(9)}> und nicht \`<@${id(1)}>\``);
    expect(encodeMentions(text, members, picked)).toBe(content);
  });
  it("knows who a message mentions, as the view shows it", () => {
    expect([...mentionedIds(`<@${id(1)}> **<@${id(2)}>**\n- > nein\n- [x] <@${id(3)}>\n\n| a |\n|---|\n| <@${id(4)}> |`)]).toEqual([id(1), id(2), id(3), id(4)]);
    expect(mentionsUser(`hi <@${id(1)}>`, id(1))).toBe(true);
    expect(mentionsUser(`\`<@${id(1)}>\``, id(1))).toBe(false);
    expect(mentionsUser("```\n<@" + id(1) + ">\n```", id(1))).toBe(false);
    expect(mentionsUser(`hi <@${id(2)}>`, id(1))).toBe(false);
  });
});

describe("mention suggestions", () => {
  it("finds the query in front of the caret", () => {
    expect(mentionQueryAt("Hallo @ma", 9)).toEqual({ start: 6, query: "ma" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("(@an", 4)).toEqual({ start: 1, query: "an" });
    expect(mentionQueryAt("Hallo @ma und", 9)).toEqual({ start: 6, query: "ma" });
    expect(mentionQueryAt("mail@ma", 7)).toBeNull();
    expect(mentionQueryAt("Hallo @max ", 11)).toBeNull();
    expect(mentionQueryAt("Hallo", 5)).toBeNull();
  });
  it("ranks names that start with the query first", () => {
    const all = [...members, { userId: id(5), displayName: "Tomas", handle: null }, { userId: id(6), displayName: "Eva Maxwell", handle: null }];
    expect(suggestMembers(all, "ma").map((m) => m.displayName)).toEqual(["Max", "Max Mustermann", "Eva Maxwell", "Tomas"]);
    expect(suggestMembers(all, "ANN").map((m) => m.displayName)).toEqual(["@anna", "Max Mustermann"]);   // "Mustermann" contains it
    expect(suggestMembers(all, "").length).toBe(5);
    expect(suggestMembers(all, "", 2).length).toBe(2);
    expect(suggestMembers(all, "zzz")).toEqual([]);
  });
});
