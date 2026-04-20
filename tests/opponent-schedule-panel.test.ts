import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __testing as scheduleTesting } from "../app/opponent-schedule-panel";
import { __testing as schedulePresentationTesting } from "../app/schedule-presentation";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("schedule helpers format BBStats totals and pending rows", () => {
  assert.equal(scheduleTesting.formatBbstats(null), "—");
  assert.equal(scheduleTesting.formatBbstats(127), "127");

  assert.equal(
    scheduleTesting.formatResult({
      opponentScore: null,
      outcome: "PENDING",
      teamScore: null,
    } as any),
    "Upcoming",
  );
  assert.equal(
    scheduleTesting.formatResult({
      opponentScore: 88,
      outcome: "WIN",
      teamScore: 102,
    } as any),
    "102-88 W",
  );
});

test("schedule helpers map seriousness badges to the right tones", () => {
  assert.equal(scheduleTesting.toneForSeriousness("YES"), "success");
  assert.equal(scheduleTesting.toneForSeriousness("MAYBE"), "note");
  assert.equal(scheduleTesting.toneForSeriousness("NO"), "danger");
});

test("schedule helpers keep the default and filtered empty-state copy stable", () => {
  assert.equal(
    scheduleTesting.defaultScheduleEmptyStateMessage(),
    "No schedule is available until a scout target is selected.",
  );
  assert.equal(
    scheduleTesting.scheduleTableEmptyStateMessage(),
    "No games match the current season and game-type filters.",
  );
});

test("schedule presentation normalizes tactic labels before rendering", () => {
  assert.equal(
    schedulePresentationTesting.resolveScheduleTacticPresentation(
      "ManToMan",
      "defense",
    ).label,
    "Man to Man",
  );
  assert.equal(
    schedulePresentationTesting.resolveScheduleTacticPresentation(
      "23Zone",
      "defense",
    ).label,
    "2-3 Zone",
  );
  assert.equal(
    schedulePresentationTesting.resolveScheduleTacticPresentation(
      "RunAndGun",
      "offense",
    ).label,
    "Run and Gun",
  );
  assert.equal(
    schedulePresentationTesting.resolveScheduleTacticPresentation(
      "Inside Box + 1",
      "defense",
    ).label,
    "Inside Box-and-One",
  );
});

test("schedule presentation computes collapsed BBStats quartiles safely", () => {
  const scale = schedulePresentationTesting.buildScheduleBbstatsScale([
    null,
    80,
    90,
    90,
    100,
    110,
    130,
  ]);

  assert.deepEqual(scale?.thresholds, [90, 110]);
  assert.equal(
    schedulePresentationTesting.resolveScheduleBbstatsPresentation(90, scale).band,
    0,
  );
  assert.equal(
    schedulePresentationTesting.resolveScheduleBbstatsPresentation(100, scale).band,
    1,
  );
  assert.equal(
    schedulePresentationTesting.resolveScheduleBbstatsPresentation(130, scale).band,
    2,
  );
  assert.equal(
    schedulePresentationTesting.resolveScheduleBbstatsPresentation(null, scale).label,
    "—",
  );
  assert.equal(
    schedulePresentationTesting.buildScheduleBbstatsScale([100, 100, 100]),
    null,
  );
});

test("schedule presentation remembers the show-colors preference with a safe default", () => {
  const storage = new MemoryStorage();

  assert.equal(schedulePresentationTesting.readScheduleShowColors(null), true);
  assert.equal(schedulePresentationTesting.readScheduleShowColors(storage), true);

  schedulePresentationTesting.writeScheduleShowColors(storage, false);
  assert.equal(schedulePresentationTesting.readScheduleShowColors(storage), false);

  schedulePresentationTesting.writeScheduleShowColors(storage, true);
  assert.equal(schedulePresentationTesting.readScheduleShowColors(storage), true);
});

test("opponent schedule source keeps grouped columns and the color toggle wired in", () => {
  const source = readFileSync(
    join(repoRoot, "app", "opponent-schedule-panel.tsx"),
    "utf8",
  );

  assert.match(source, /colSpan=\{3\}[\s\S]*?>\s*Team\s*</);
  assert.match(source, /colSpan=\{4\}[\s\S]*?>\s*Opponent\s*</);
  assert.match(source, /Show colors/);

  const teamOffenseIndex = source.indexOf("renderTacticCellValue(row.teamOffense");
  const teamDefenseIndex = source.indexOf("renderTacticCellValue(row.teamDefense");
  const teamBbstatsIndex = source.indexOf("row.teamBbStatsTotal");
  const opponentNameIndex = source.indexOf("row.opponentTeamName");
  const opponentOffenseIndex = source.indexOf(
    "renderTacticCellValue(row.opponentOffense",
  );
  const opponentDefenseIndex = source.indexOf(
    "renderTacticCellValue(row.opponentDefense",
  );
  const opponentBbstatsIndex = source.indexOf("row.opponentBbStatsTotal");
  const resultIndex = source.indexOf("formatResult(row)");

  assert.ok(teamOffenseIndex !== -1);
  assert.ok(teamOffenseIndex < teamDefenseIndex);
  assert.ok(teamDefenseIndex < teamBbstatsIndex);
  assert.ok(teamBbstatsIndex < opponentNameIndex);
  assert.ok(opponentNameIndex < opponentOffenseIndex);
  assert.ok(opponentOffenseIndex < opponentDefenseIndex);
  assert.ok(opponentDefenseIndex < opponentBbstatsIndex);
  assert.ok(opponentBbstatsIndex < resultIndex);
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
