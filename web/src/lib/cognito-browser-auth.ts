import {
  AssociateSoftwareTokenCommand,
  AuthenticationResultType,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
  VerifySoftwareTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { requireEnv, optionalEnv } from "@/lib/env";

export type BrowserAuthTokens = {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
};

export function getCognitoBrowserAuthClient() {
  const region = optionalEnv("COGNITO_REGION") ?? optionalEnv("AWS_REGION") ?? "us-east-1";
  return new CognitoIdentityProviderClient({ region });
}

export function getCognitoBrowserClientId() {
  return requireEnv("COGNITO_APP_CLIENT_ID");
}

export function mapAuthenticationResult(result: AuthenticationResultType | undefined): BrowserAuthTokens | null {
  if (!result?.AccessToken || !result.ExpiresIn) {
    return null;
  }
  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn,
  };
}

export async function signInWithPassword(params: {
  email: string;
  password: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new InitiateAuthCommand({
      ClientId: getCognitoBrowserClientId(),
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: params.email,
        PASSWORD: params.password,
      },
    }),
  );
}

export async function respondToSoftwareTokenChallenge(params: {
  email: string;
  code: string;
  session: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new RespondToAuthChallengeCommand({
      ClientId: getCognitoBrowserClientId(),
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      Session: params.session,
      ChallengeResponses: {
        USERNAME: params.email,
        SOFTWARE_TOKEN_MFA_CODE: params.code,
      },
    }),
  );
}

export async function startSoftwareTokenSetup(params: {
  accessToken?: string;
  session?: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new AssociateSoftwareTokenCommand({
      AccessToken: params.accessToken,
      Session: params.session,
    }),
  );
}

export async function verifySoftwareToken(params: {
  code: string;
  accessToken?: string;
  session?: string;
  friendlyDeviceName?: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new VerifySoftwareTokenCommand({
      AccessToken: params.accessToken,
      Session: params.session,
      UserCode: params.code,
      FriendlyDeviceName: params.friendlyDeviceName,
    }),
  );
}

export async function completeMfaSetupChallenge(params: {
  email: string;
  session: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new RespondToAuthChallengeCommand({
      ClientId: getCognitoBrowserClientId(),
      ChallengeName: "MFA_SETUP",
      Session: params.session,
      ChallengeResponses: {
        USERNAME: params.email,
      },
    }),
  );
}

export async function signUpWithPassword(params: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new SignUpCommand({
      ClientId: getCognitoBrowserClientId(),
      Username: params.email,
      Password: params.password,
      UserAttributes: [
        { Name: "email", Value: params.email },
        { Name: "given_name", Value: params.firstName },
        { Name: "family_name", Value: params.lastName },
      ],
    }),
  );
}

export async function confirmSignUpCode(params: {
  email: string;
  code: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new ConfirmSignUpCommand({
      ClientId: getCognitoBrowserClientId(),
      Username: params.email,
      ConfirmationCode: params.code,
    }),
  );
}

export async function resendSignUpCode(params: {
  email: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new ResendConfirmationCodeCommand({
      ClientId: getCognitoBrowserClientId(),
      Username: params.email,
    }),
  );
}

export async function requestForgotPasswordCode(params: {
  email: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new ForgotPasswordCommand({
      ClientId: getCognitoBrowserClientId(),
      Username: params.email,
    }),
  );
}

export async function confirmForgotPasswordCode(params: {
  email: string;
  code: string;
  newPassword: string;
}) {
  const cognito = getCognitoBrowserAuthClient();
  return cognito.send(
    new ConfirmForgotPasswordCommand({
      ClientId: getCognitoBrowserClientId(),
      Username: params.email,
      ConfirmationCode: params.code,
      Password: params.newPassword,
    }),
  );
}
