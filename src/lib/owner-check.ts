import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { adminClient } from "./admin";
import { BRAND } from "./brand";
import { getAccount, getChallenge, isOwnerEmail, markOwnerClaimed, setChallenge, setOwnerChecked, type Account } from "./auth";
import { SignInError, redeemCode, redeemToken, sendSignIn } from "./accounts";
import { siteOrigin } from "./server-data";
import { consoleEmail } from "./console-auth";

/**
 * The site owner's second check: Face ID or Touch ID on this device (a passkey), or a code sent to their email.
 * Passing it opens the site owner's page for 12 hours on this device.
 */

interface Passkey {
  id: string;
  public_key: string;
  counter: number;
  transports: string[] | null;
}

function where(req: Request) {
  const origin = siteOrigin(req);
  return { origin, rpID: new URL(origin).hostname };
}

/** The owner, or a member of support staff: signed in with their email, the second check still to do. */
async function ownerAccount(): Promise<Account> {
  const a = await getAccount();
  if (!a || !(await consoleEmail(a.email))) throw new SignInError("Sign in with the site owner's email, or a staff email, first", 401);
  return a;
}

async function passkeys(accountId: string): Promise<Passkey[]> {
  const { data, error } = await adminClient().from("owner_passkeys").select("id,public_key,counter,transports").eq("account_id", accountId);
  return error ? [] : ((data ?? []) as Passkey[]);
}

export async function passkeyCount(accountId: string) {
  return (await passkeys(accountId)).length;
}

async function passed() {
  await setOwnerChecked();
  const a = await getAccount();
  if (isOwnerEmail(a?.email)) await markOwnerClaimed().catch(() => {});
}

/** The code by email (and the button in the same email). */
export async function sendOwnerCode(req: Request) {
  const a = await ownerAccount();
  await sendSignIn(siteOrigin(req), a.email, { purpose: "owner", next: "/console", intro: `Someone (hopefully you) is opening the console on ${BRAND.name}. Tap the button, or type the code, to carry on.` });
}

export async function checkOwnerCode(code: string) {
  const a = await ownerAccount();
  await redeemCode(a.email, code, "owner");
  await passed();
}

export async function checkOwnerLink(token: string) {
  const { email } = await redeemToken(token, "owner");
  const a = await ownerAccount();
  if (email !== a.email.toLowerCase()) throw new SignInError("That link was for a different email", 401);
  await passed();
}

/** Face ID on this device: the question for the phone to answer. */
export async function passkeyQuestion(req: Request) {
  const a = await ownerAccount();
  const keys = await passkeys(a.id);
  if (!keys.length) throw new SignInError("Face ID isn't set up on this account yet. Use the emailed code.", 404);
  const options = await generateAuthenticationOptions({
    rpID: where(req).rpID,
    allowCredentials: keys.map((k) => ({ id: k.id, transports: (k.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined })),
    userVerification: "required",
  });
  await setChallenge(options.challenge);
  return options;
}

export async function passkeyAnswer(req: Request, response: AuthenticationResponseJSON) {
  const a = await ownerAccount();
  const expected = await getChallenge();
  if (!expected) throw new SignInError("That took too long. Try again.", 410);
  const key = (await passkeys(a.id)).find((k) => k.id === response?.id);
  if (!key) throw new SignInError("That isn't a Face ID set up for this account", 401);
  const { origin, rpID } = where(req);
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: expected,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: key.id, publicKey: isoBase64URL.toBuffer(key.public_key), counter: Number(key.counter), transports: (key.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined },
  }).catch(() => null);
  await setChallenge(null);
  if (!v?.verified) throw new SignInError("Face ID didn't match. Try again, or use the emailed code.", 401);
  await adminClient().from("owner_passkeys").update({ counter: v.authenticationInfo.newCounter, used_at: new Date().toISOString() }).eq("id", key.id);
  await passed();
}

/** Setting up Face ID on this device (after passing the check another way). */
export async function passkeySetup(req: Request) {
  const a = await ownerAccount();
  const options = await generateRegistrationOptions({
    rpName: BRAND.name,
    rpID: where(req).rpID,
    userName: a.email,
    userID: isoUint8Array.fromUTF8String(a.id),
    attestationType: "none",
    excludeCredentials: (await passkeys(a.id)).map((k) => ({ id: k.id, transports: (k.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required", authenticatorAttachment: "platform" },
  });
  await setChallenge(options.challenge);
  return options;
}

export async function passkeySave(req: Request, response: RegistrationResponseJSON) {
  const a = await ownerAccount();
  const expected = await getChallenge();
  if (!expected) throw new SignInError("That took too long. Try again.", 410);
  const { origin, rpID } = where(req);
  const v = await verifyRegistrationResponse({ response, expectedChallenge: expected, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }).catch(() => null);
  await setChallenge(null);
  if (!v?.verified || !v.registrationInfo) throw new SignInError("Couldn't set up Face ID. Try again.", 400);
  const c = v.registrationInfo.credential;
  const { error } = await adminClient()
    .from("owner_passkeys")
    .upsert({ id: c.id, account_id: a.id, public_key: isoBase64URL.fromBuffer(c.publicKey), counter: c.counter, transports: c.transports ?? null });
  if (error) throw new SignInError(/owner_passkeys/.test(error.message) ? "This needs the latest database update (schema.sql)" : "Couldn't save Face ID. Try again.", 500);
}
