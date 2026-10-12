export const QA_PROFILE = "qa";
export const QA_USER_ID = "ankileet-qa-user";
export const QA_USER_EMAIL = "qa@ankileet.local";
export const QA_SESSION_ID = "ankileet-qa-session";
export const QA_SESSION_TOKEN = "ankileet-qa-session-token";
export const QA_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** A second, empty account for checking that nothing crosses accounts. */
export const QA_SECOND_USER_ID = "ankileet-qa-user-2";
export const QA_SECOND_USER_EMAIL = "qa2@ankileet.local";
export const QA_SECOND_SESSION_ID = "ankileet-qa-session-2";
export const QA_SECOND_SESSION_TOKEN = "ankileet-qa-session-token-2";

export function isQaProfile() {
  return process.env.ANKILEET_PROFILE === QA_PROFILE;
}
