export type AuthScreen =
  | "loading"
  | "signIn"
  | "signUp"
  | "confirmSignUp"
  | "requestReset"
  | "confirmReset"
  | "signedIn";

export type AuthNotice = {
  message: string;
  tone: "danger" | "note";
};

export type AuthUiState = {
  screen: AuthScreen;
  email: string;
  pendingUsername: string | null;
  isBusy: boolean;
  notice: AuthNotice | null;
};

export type AuthUiStatePatch = Omit<AuthUiState, "isBusy">;

export function createAuthUiState(
  overrides: Partial<AuthUiState> = {},
): AuthUiState {
  return {
    screen: "loading",
    email: "",
    pendingUsername: null,
    isBusy: false,
    notice: null,
    ...overrides,
  };
}

export function resolveSignInStep(
  step: string,
  email: string,
): AuthUiStatePatch {
  switch (step) {
    case "DONE":
      return {
        screen: "signedIn",
        email,
        pendingUsername: null,
        notice: null,
      };
    case "CONFIRM_SIGN_UP":
      return {
        screen: "confirmSignUp",
        email,
        pendingUsername: email,
        notice: {
          tone: "note",
          message: "Confirm your email to finish creating your account.",
        },
      };
    case "RESET_PASSWORD":
      return {
        screen: "requestReset",
        email,
        pendingUsername: email,
        notice: {
          tone: "note",
          message: "Reset your password before signing in.",
        },
      };
    default:
      return {
        screen: "signIn",
        email,
        pendingUsername: null,
        notice: {
          tone: "danger",
          message: unsupportedStepMessage("sign-in", step),
        },
      };
  }
}

export function resolveSignUpStep(
  step: string,
  email: string,
): AuthUiStatePatch {
  switch (step) {
    case "CONFIRM_SIGN_UP":
      return {
        screen: "confirmSignUp",
        email,
        pendingUsername: email,
        notice: {
          tone: "note",
          message: "We sent a confirmation code to your email.",
        },
      };
    case "DONE":
    case "COMPLETE_AUTO_SIGN_IN":
      return {
        screen: "signIn",
        email,
        pendingUsername: null,
        notice: {
          tone: "note",
          message: "Your account is ready. Sign in to continue.",
        },
      };
    default:
      return {
        screen: "signUp",
        email,
        pendingUsername: null,
        notice: {
          tone: "danger",
          message: unsupportedStepMessage("sign-up", step),
        },
      };
  }
}

export function resolveConfirmSignUpStep(
  step: string,
  email: string,
): AuthUiStatePatch {
  switch (step) {
    case "DONE":
    case "COMPLETE_AUTO_SIGN_IN":
      return {
        screen: "signIn",
        email,
        pendingUsername: null,
        notice: {
          tone: "note",
          message: "Account confirmed. Sign in to continue.",
        },
      };
    default:
      return {
        screen: "confirmSignUp",
        email,
        pendingUsername: email,
        notice: {
          tone: "danger",
          message: unsupportedStepMessage("confirm sign-up", step),
        },
      };
  }
}

export function resolveResetPasswordStep(
  step: string,
  email: string,
): AuthUiStatePatch {
  switch (step) {
    case "CONFIRM_RESET_PASSWORD_WITH_CODE":
      return {
        screen: "confirmReset",
        email,
        pendingUsername: email,
        notice: {
          tone: "note",
          message: "Enter the reset code from your email and set a new password.",
        },
      };
    case "DONE":
      return resolveConfirmResetPasswordSuccess(email);
    default:
      return {
        screen: "requestReset",
        email,
        pendingUsername: email,
        notice: {
          tone: "danger",
          message: unsupportedStepMessage("reset password", step),
        },
      };
  }
}

export function resolveConfirmResetPasswordSuccess(
  email: string,
): AuthUiStatePatch {
  return {
    screen: "signIn",
    email,
    pendingUsername: null,
    notice: {
      tone: "note",
      message: "Password updated. Sign in with your new password.",
    },
  };
}

function unsupportedStepMessage(flow: string, step: string): string {
  return `The ${flow} flow returned an unsupported step: ${step}.`;
}
