import type { Schema } from "../resource";
import { getManualSalaryEstimate } from "../_backend/salary-calculator";

type Handler = Schema["getManualSalaryEstimate"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getManualSalaryEstimate({
    identity: event.identity,
    input: event.arguments.input,
  });
};
