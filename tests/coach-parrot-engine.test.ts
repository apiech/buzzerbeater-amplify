import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRawPlayerSkills,
  evaluateLineup,
  evaluateRoster,
  rankRoster,
  sampleFixture,
  coachParrotArtifacts,
  type CoachParrotRoster,
  type LineupAssignment,
  type Position,
  type RawPlayerSkills,
} from "../lib/coach-parrot";

function buildSampleInputs() {
  const sample = sampleFixture();
  const roster: CoachParrotRoster = {
    players: sample.players.map<RawPlayerSkills>((player) => ({
      playerId: player.player_id,
      name: player.name,
      js: player.skills.JS,
      jr: player.skills.JR,
      od: player.skills.OD,
      ha: player.skills.HA,
      dr: player.skills.DR,
      pa: player.skills.PA,
      is: player.skills.IS,
      id: player.skills.ID,
      rb: player.skills.RB,
      sb: player.skills.SB,
      st: player.st,
      ft: player.ft,
      ex: player.ex,
      gs: player.gs,
    })),
  };
  const lineup = sample.lineup.map<LineupAssignment>((assignment) => ({
    position: assignment.position,
    playerId: assignment.player_id,
    minutes: assignment.minutes,
  }));
  const context = {
    offense: sample.context.offense,
    defense: sample.context.defense,
    enthusiasm: sample.context.enthusiasm,
    homeCourt: sample.context.home_court,
  };
  return { sample, roster, lineup, context };
}

test("CoachParrot explicit-lineup evaluation matches the extracted workbook sample", () => {
  const { sample, roster, lineup, context } = buildSampleInputs();
  const evaluation = evaluateLineup({
    roster,
    lineup,
    context,
  });

  for (const rating of Object.keys(sample.ratings) as Array<keyof typeof sample.ratings>) {
    const expected = sample.ratings[rating];
    assert.ok(Math.abs(evaluation.rawRatings[rating] - expected.raw) < 1e-10);
    assert.ok(
      Math.abs(evaluation.roundedRatings[rating] - expected.rounded) < 1e-10,
    );
    assert.equal(evaluation.ratingLabels[rating], expected.label);
    assert.equal(evaluation.outputBandLabels[rating], expected.band);
  }
});

test("CoachParrot rankings match the sample positional outputs", () => {
  const { sample, roster, context } = buildSampleInputs();
  const rankings = rankRoster({
    roster,
    context,
  }).rankings;

  for (const position of ["PG", "SG", "SF", "PF", "C"] as Position[]) {
    const expected = [...sample.players]
      .sort(
        (left, right) =>
          right.position_outputs[position] - left.position_outputs[position] ||
          left.name.localeCompare(right.name) ||
          left.player_id.localeCompare(right.player_id),
      )
      .map((player) => player.player_id);
    assert.deepEqual(
      rankings[position].map((entry) => entry.playerId),
      expected,
    );
  }
});

test("CoachParrot roster-only autofill allocates 48 minutes at every position", () => {
  const { roster, context } = buildSampleInputs();
  const evaluation = evaluateRoster({
    roster,
    context,
  });

  const slotMinutes = Object.fromEntries(
    (["PG", "SG", "SF", "PF", "C"] as Position[]).map((position) => [position, 0]),
  ) as Record<Position, number>;

  for (const assignment of evaluation.chosenLineup) {
    slotMinutes[assignment.position] += assignment.minutes;
  }

  assert.deepEqual(slotMinutes, {
    PG: 48,
    SG: 48,
    SF: 48,
    PF: 48,
    C: 48,
  });
});

test("CoachParrot context changes alter the generated ratings", () => {
  const { roster, lineup, context } = buildSampleInputs();
  const base = evaluateLineup({
    roster,
    lineup,
    context,
  });
  const home = evaluateLineup({
    roster,
    lineup,
    context: {
      ...context,
      homeCourt: "Home Court",
    },
  });
  const alternate = evaluateLineup({
    roster,
    lineup,
    context: {
      ...context,
      homeCourt: "Home Court",
      enthusiasm: 12,
    },
  });

  for (const rating of ["outsideScoring", "insideScoring", "offensiveFlow"] as const) {
    assert.ok(Math.abs(base.rawRatings[rating] - home.rawRatings[rating]) < 1e-10);
    assert.ok(Math.abs(base.rawRatings[rating] - alternate.rawRatings[rating]) < 1e-10);
  }

  for (const rating of ["outsideDefense", "insideDefense", "rebounding"] as const) {
    const expectedHome =
      base.rawRatings[rating] +
      Math.log1p(base.rawRatings[rating]) *
        (coachParrotArtifacts.home_court_adjustments[rating] ?? 0);
    const expectedAlternate =
      expectedHome +
      Math.log1p(base.rawRatings[rating]) *
        ((12 - 5) * (coachParrotArtifacts.enthusiasm_adjustments[rating] ?? 0));
    assert.ok(Math.abs(home.rawRatings[rating] - expectedHome) < 1e-10);
    assert.ok(Math.abs(alternate.rawRatings[rating] - expectedAlternate) < 1e-10);
  }
});

test("CoachParrot artifact includes extracted context coefficients", () => {
  assert.equal(coachParrotArtifacts.version, "coach_parrot_v2");
  assert.deepEqual(coachParrotArtifacts.home_court_flags, {
    "Away or Neutral": 0,
    "Home Court": 1,
  });
  assert.equal(
    Object.keys(coachParrotArtifacts.enthusiasm_adjustments).sort().join(","),
    "insideDefense,outsideDefense,rebounding",
  );
  assert.equal(
    Object.keys(coachParrotArtifacts.home_court_adjustments).sort().join(","),
    "insideDefense,outsideDefense,rebounding",
  );
});

test("CoachParrot skill normalization accepts legacy roster key variants", () => {
  const player = buildRawPlayerSkills({
    playerId: "p1",
    name: "Legacy Alias Guard",
    skills: {
      jump_range: 11,
      outside_def: 12,
      rebound: 13,
      shot_blocking: 14,
      game_shape: "strong",
    },
  });

  assert.equal(player.jr, 11);
  assert.equal(player.od, 12);
  assert.equal(player.rb, 13);
  assert.equal(player.sb, 14);
  assert.equal(player.gs, 8);
});

test("CoachParrot tactic context still changes ratings independently of venue modifiers", () => {
  const { roster, context } = buildSampleInputs();
  const base = evaluateRoster({
    roster,
    context,
  });
  const alternate = evaluateRoster({
    roster,
    context: {
      ...context,
      offense: "Run and Gun",
      defense: "Man to man",
      homeCourt: "Home Court",
    },
  });

  assert.notDeepEqual(
    base.rawRatings.outsideScoring + base.rawRatings.offensiveFlow,
    alternate.rawRatings.outsideScoring + alternate.rawRatings.offensiveFlow,
  );
});
