import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveConfirmResetPasswordSuccess,
  resolveConfirmSignUpStep,
  resolveResetPasswordStep,
  resolveSignInStep,
  resolveSignUpStep,
} from "../app/auth-flow";

test("sign-in success transitions into the signed-in screen", () => {
  const state = resolveSignInStep("DONE", "coach@example.com");

  assert.equal(state.screen, "signedIn");
  assert.equal(state.email, "coach@example.com");
  assert.equal(state.notice, null);
});

test("sign-in requiring confirmation routes into the confirm sign-up flow", () => {
  const state = resolveSignInStep("CONFIRM_SIGN_UP", "coach@example.com");

  assert.equal(state.screen, "confirmSignUp");
  assert.equal(state.pendingUsername, "coach@example.com");
  assert.equal(state.notice?.tone, "note");
});

test("sign-in requiring reset routes into the password reset request flow", () => {
  const state = resolveSignInStep("RESET_PASSWORD", "coach@example.com");

  assert.equal(state.screen, "requestReset");
  assert.equal(state.pendingUsername, "coach@example.com");
  assert.equal(state.notice?.tone, "note");
});

test("sign-up requiring confirmation routes into the confirm sign-up flow", () => {
  const state = resolveSignUpStep("CONFIRM_SIGN_UP", "coach@example.com");

  assert.equal(state.screen, "confirmSignUp");
  assert.equal(state.pendingUsername, "coach@example.com");
  assert.equal(state.notice?.tone, "note");
});

test("confirm sign-up success returns the user to sign-in with a success notice", () => {
  const state = resolveConfirmSignUpStep("DONE", "coach@example.com");

  assert.equal(state.screen, "signIn");
  assert.equal(state.email, "coach@example.com");
  assert.equal(state.notice?.tone, "note");
});

test("reset-password request and completion transition back to sign-in", () => {
  const requestState = resolveResetPasswordStep(
    "CONFIRM_RESET_PASSWORD_WITH_CODE",
    "coach@example.com",
  );
  const completionState = resolveConfirmResetPasswordSuccess("coach@example.com");

  assert.equal(requestState.screen, "confirmReset");
  assert.equal(requestState.pendingUsername, "coach@example.com");
  assert.equal(completionState.screen, "signIn");
  assert.equal(completionState.notice?.tone, "note");
});
