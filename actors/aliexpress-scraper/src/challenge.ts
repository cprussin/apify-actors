/** AliExpress answered with a bot check (slider captcha / "punish" page). */
export class BlockedError extends Error {}

/** The response isn't what we expected and isn't a known bot check either. */
export class ParseError extends Error {}

const MARKERS = [
  "_____tmd_____",
  "x5secdata",
  "/punish?",
  "punish-component",
  "fail_sys_user_validate",
  "rgv587_error",
  "baxia-dialog",
  "nc_1_n1z", // slider captcha element
  "captcha interception",
  "slide to verify",
];

/** True if the body looks like an Alibaba anti-bot interstitial. */
export function isChallenge(body: string): boolean {
  const s = body.slice(0, 200_000).toLowerCase();
  return MARKERS.some((m) => s.includes(m));
}
