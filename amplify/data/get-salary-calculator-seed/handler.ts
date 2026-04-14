import type { Schema } from "../resource";
import { env } from "$amplify/env/get-salary-calculator-seed";
import { getSalaryCalculatorSeed } from "../_backend/salary-calculator";

type Handler = Schema["getSalaryCalculatorSeed"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getSalaryCalculatorSeed({
    env,
    identity: event.identity,
    playerId: event.arguments.playerId,
  });
};
