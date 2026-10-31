import { describe, expect, it } from "vitest";
import {
  asInteger,
  asText,
  isSource2Header,
  parseDemoReplaySnapshot,
  parseDemoSnapshot,
  sanitizeSchema,
  toRows,
  type DemoParserPort,
} from "../src/index.js";

describe("parser boundary", () => {
  it("normalizes array-of-structs and struct-of-arrays", () => {
    expect(toRows([{ tick: 1, name: "x" }])).toEqual([{ tick: 1, name: "x" }]);
    expect(toRows({ tick: [1, 2], name: ["x", "y"] })).toEqual([
      { tick: 1, name: "x" },
      { tick: 2, name: "y" },
    ]);
  });
  it("uses aliases and never substitutes missing data with zero", () => {
    expect(asInteger({ team_number: 3 }, ["team_num", "team_number"])).toBe(3);
    expect(asInteger({}, ["tick"])).toBeNull();
    expect(asText({ steamid: 765n }, ["steamid"])).toBe("765");
  });
  it("recognizes only Source 2 headers and emits schema only", () => {
    expect(isSource2Header({ demo_version_name: "valve_demo_2" })).toBe(true);
    expect(isSource2Header({ demo_version_name: "valve_demo" })).toBe(false);
    expect(sanitizeSchema([{ name: "secret", tick: 3 }])).toEqual({
      count: 1,
      columns: ["name", "tick"],
    });
  });
  it("calls the five required APIs once and limits tick reads to selected event ticks", () => {
    const calls: string[] = [];
    const parser: DemoParserPort = {
      parseHeader: () => {
        calls.push("parseHeader");
        return { demo_version_name: "valve_demo_2" };
      },
      parsePlayerInfo: () => {
        calls.push("parsePlayerInfo");
        return [];
      },
      listGameEvents: () => {
        calls.push("listGameEvents");
        return ["round_end", "player_death"];
      },
      parseEvents: (_path, names) => {
        calls.push(`parseEvents:${names.join(",")}`);
        return [
          { event_name: "round_end", tick: 200 },
          { event_name: "player_death", tick: 150 },
        ];
      },
      parseTicks: (_path, props, ticks) => {
        calls.push(`parseTicks:${props.join(",")}:${ticks?.join(",")}`);
        return [];
      },
    };
    const snapshot = parseDemoSnapshot("synthetic.dem", parser);
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.ticks.every((row) => row.cash === undefined)).toBe(true);
    expect(calls).toEqual([
      "parseHeader",
      "parsePlayerInfo",
      "listGameEvents",
      "parseEvents:round_end,player_death",
      "parseTicks:team_num,team_name,team_rounds_total,is_alive,game_time,current_equip_value,inventory,armor_value,has_helmet,has_defuser,cash:150,200",
    ]);
  });
  it("samples replay at 4 Hz, includes round boundaries, and requests only factual player state", () => {
    let requestedProps: string[] = [];
    let requestedTicks: number[] = [];
    const parser: DemoParserPort = {
      parseHeader: () => ({}), parsePlayerInfo: () => [], listGameEvents: () => [], parseEvents: () => [],
      parseTicks: (_path, props, ticks) => {
        requestedProps = props;
        requestedTicks = ticks ?? [];
        return requestedTicks.map((tick) => ({ tick, steamid: '76561198000000000', X: -10, Y: 20, Z: 3, yaw: null, pitch: null, is_alive: true }));
      }
    };
    const snapshot = parseDemoReplaySnapshot('synthetic.dem', {
      tickRate: 64, sampleRateHz: 4,
      rounds: [{ id: 'round_1', ordinal: 1, startTick: 100, freezeEndTick: 110, endTick: 140 }]
    }, parser);
    expect(requestedProps).toEqual(['X','Y','Z','yaw','pitch','steamid','is_alive']);
    expect(requestedTicks).toEqual([100, 110, 116, 132, 140]);
    expect(snapshot.rows[0]).toMatchObject({ X: -10, Y: 20, is_alive: true });
  });
});
