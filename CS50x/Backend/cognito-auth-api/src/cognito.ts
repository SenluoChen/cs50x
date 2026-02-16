import crypto from "crypto";
import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";
import { env } from "./env.js";

export const cognito = new CognitoIdentityProviderClient({ region: env.awsRegion });

export function secretHash(username: string): string | undefined {
  if (!env.clientSecret) return undefined;
  const h = crypto
    .createHmac("sha256", env.clientSecret)
    .update(username + env.clientId)
    .digest("base64");
  return h;
}

function secretHashParam(username: string): { SecretHash: string } | {} {
  const h = secretHash(username);
  return h ? { SecretHash: h } : {};
}

export async function cognitoSignup(email: string, password: string) {
  const Username = email;
  const cmd = new SignUpCommand({
    ClientId: env.clientId,
    Username,
    Password: password,
    ...secretHashParam(Username),
    UserAttributes: [{ Name: "email", Value: email }],
  });
  return cognito.send(cmd);
}

export async function cognitoConfirm(email: string, code: string) {
  const Username = email;
  const cmd = new ConfirmSignUpCommand({
    ClientId: env.clientId,
    Username,
    ConfirmationCode: code,
    ...secretHashParam(Username),
  });
  return cognito.send(cmd);
}

export async function cognitoResendConfirmation(email: string) {
  const Username = email;
  const cmd = new ResendConfirmationCodeCommand({
    ClientId: env.clientId,
    Username,
    ...secretHashParam(Username),
  });
  return cognito.send(cmd);
}

export async function cognitoLogin(email: string, password: string): Promise<AuthenticationResultType | undefined> {
  const Username = email;
  const cmd = new InitiateAuthCommand({
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: env.clientId,
    AuthParameters: {
      USERNAME: Username,
      PASSWORD: password,
      ...(env.clientSecret ? { SECRET_HASH: secretHash(Username) } : {}),
    },
  });
  const res = await cognito.send(cmd);
  return res.AuthenticationResult;
}

export async function cognitoRefresh(email: string, refreshToken: string): Promise<AuthenticationResultType | undefined> {
  const Username = email;
  const cmd = new InitiateAuthCommand({
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: env.clientId,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
      ...(env.clientSecret ? { SECRET_HASH: secretHash(Username) } : {}),
    },
  });
  const res = await cognito.send(cmd);
  return res.AuthenticationResult;
}

export async function cognitoForgotPassword(email: string) {
  const Username = email;
  const cmd = new ForgotPasswordCommand({
    ClientId: env.clientId,
    Username,
    ...secretHashParam(Username),
  });
  return cognito.send(cmd);
}

export async function cognitoConfirmForgotPassword(email: string, code: string, newPassword: string) {
  const Username = email;
  const cmd = new ConfirmForgotPasswordCommand({
    ClientId: env.clientId,
    Username,
    ConfirmationCode: code,
    Password: newPassword,
    ...secretHashParam(Username),
  });
  return cognito.send(cmd);
}
